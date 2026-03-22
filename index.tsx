import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as MediaLibrary from 'expo-media-library';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PetAvatar } from '@/components/pet-avatar';
import { useStorageStats } from '@/hooks/use-storage-stats';
import { storageEvent } from '@/hooks/storage-event';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ScanStatus = 'idle' | 'scanning' | 'done';

type ScanStep = {
  label: string;
  done: boolean;
};

const SCAN_STEPS: ScanStep[] = [
  { label: '读取照片库…', done: false },
  { label: '聚类时间段…', done: false },
  { label: '识别相似组…', done: false },
  { label: '扫描截图…', done: false },
];

export default function HomeScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanSteps, setScanSteps] = useState<ScanStep[]>(SCAN_STEPS);
  const [summary, setSummary] = useState<{
    similarGroups: number;
    similarPhotos: number;
    screenshotCount: number;
  } | null>(null);

  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'dark';
  const insets = useSafeAreaInsets();
  const { stats, loading: statsLoading, refresh: refreshStats } = useStorageStats();
  const prevFreedRef = useRef(0);
  const [triggerFreed, setTriggerFreed] = useState(0);

  // Progress bar animation
  const progressWidth = useSharedValue(0);
  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%` as `${number}%`,
  }));

  useEffect(() => {
    (async () => {
      const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync();
      if (status === 'granted') { setHasPermission(true); return; }
      if (!canAskAgain) { setHasPermission(false); return; }
      const req = await MediaLibrary.requestPermissionsAsync();
      setHasPermission(req.status === 'granted');
    })();
  }, []);

  // When freed bytes change, pass a snapshot to pet
  useEffect(() => {
    if (stats.freedBytes !== prevFreedRef.current) {
      setTriggerFreed(stats.freedBytes);
      prevFreedRef.current = stats.freedBytes;
    }
  }, [stats.freedBytes]);

  // Listen for delete events from sub-screens and refresh stats
  useEffect(() => {
    const unsub = storageEvent.on(() => {
      refreshStats();
    });
    return unsub;
  }, [refreshStats]);

  const handleEnsurePermission = useCallback(() => {
    if (hasPermission === false) {
      Alert.alert('需要相册权限', '请在系统设置中打开相册访问权限，以便帮你清理相似照片和截图。');
      return false;
    }
    if (hasPermission === null) {
      Alert.alert('正在请求权限', '请先在系统弹窗中选择"允许访问照片"。');
      return false;
    }
    return true;
  }, [hasPermission]);

  const advanceStep = useCallback((index: number, progress: number) => {
    setScanSteps((prev) => prev.map((s, i) => ({ ...s, done: i <= index })));
    progressWidth.value = withTiming(progress, { duration: 400, easing: Easing.out(Easing.cubic) });
  }, [progressWidth]);

  const scanPhotos = useCallback(async () => {
    if (!handleEnsurePermission()) return;
    if (scanStatus === 'scanning') return;

    try {
      setScanStatus('scanning');
      setScanSteps(SCAN_STEPS.map((s) => ({ ...s, done: false })));
      progressWidth.value = 0;

      // Step 1 – fetch assets
      const pageSize = 500;
      let hasNextPage = true;
      let endCursor: string | undefined;
      const assets: MediaLibrary.Asset[] = [];

      while (hasNextPage && assets.length < 2000) {
        const page = await MediaLibrary.getAssetsAsync({
          mediaType: ['photo'],
          first: pageSize,
          after: endCursor,
          sortBy: [['creationTime', false]],
        });
        assets.push(...page.assets);
        hasNextPage = page.hasNextPage;
        endCursor = page.endCursor ?? undefined;
      }
      advanceStep(0, 25);

      // Step 2 – time clustering
      const sorted = assets
        .filter((a) => a.creationTime != null)
        .sort((a, b) => (a.creationTime ?? 0) - (b.creationTime ?? 0));

      const timeClusters: MediaLibrary.Asset[][] = [];
      const maxGapMs = 30 * 60 * 1000;
      for (const asset of sorted) {
        const t = asset.creationTime ?? 0;
        const last = timeClusters[timeClusters.length - 1];
        if (!last || t - (last[last.length - 1].creationTime ?? 0) > maxGapMs) {
          timeClusters.push([asset]);
        } else {
          last.push(asset);
        }
      }
      advanceStep(1, 50);

      // Step 3 – similar groups
      const similarGroups: MediaLibrary.Asset[][] = [];
      for (const cluster of timeClusters) {
        const byKey: Record<string, MediaLibrary.Asset[]> = {};
        for (const asset of cluster) {
          const key = `${asset.width}x${asset.height}`;
          if (!byKey[key]) byKey[key] = [];
          byKey[key].push(asset);
        }
        Object.values(byKey).forEach((group) => {
          if (group.length < 2) return;
          group.sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0));
          const rep = group[0];
          const repSize = rep.fileSize ?? 0;
          const close: MediaLibrary.Asset[] = [];
          for (const asset of group) {
            if (!repSize || !asset.fileSize) { close.push(asset); continue; }
            const ratio = Math.min(repSize, asset.fileSize) / Math.max(repSize, asset.fileSize);
            if (ratio >= 0.5) close.push(asset);
          }
          if (close.length >= 2) similarGroups.push(close);
        });
      }
      advanceStep(2, 75);

      // Step 4 – screenshots
      const screenshots = assets.filter((asset) => {
        const name = (asset.filename ?? '').toLowerCase();
        const byName = name.includes('screenshot') || name.includes('screen') || name.includes('屏幕快照');
        const bySubtype = Array.isArray(asset.mediaSubtypes) &&
          asset.mediaSubtypes.some((s) => s.toLowerCase().includes('screenshot'));
        const ratio = asset.height && asset.width ? asset.height / asset.width : 0;
        return byName || bySubtype || ratio > 1.7;
      });
      advanceStep(3, 100);

      setSummary({
        similarGroups: similarGroups.length,
        similarPhotos: similarGroups.reduce((sum, g) => sum + g.length, 0),
        screenshotCount: screenshots.length,
      });
      setScanStatus('done');
      await refreshStats();
    } catch (e) {
      console.error(e);
      Alert.alert('扫描失败', '读取相册时出现问题，请稍后重试。');
      setScanStatus('idle');
    }
  }, [handleEnsurePermission, scanStatus, advanceStep, refreshStats, progressWidth]);

  const cardBg = colorScheme === 'dark' ? '#1C1C2E' : '#F5F0FF';
  const featBg = colorScheme === 'dark' ? '#12122A' : '#FFFFFF';
  const accentText = colorScheme === 'dark' ? '#A78BFA' : '#7C3AED';

  const features = useMemo(() => [
    {
      route: '/similar-clean',
      icon: 'photo.on.rectangle.angled' as const,
      title: '相似照片清理',
      sub: '按时间+相似度自动分组，一键保留最清晰的一张',
      badge: summary ? `${summary.similarGroups} 组` : null,
      badgeColor: '#7C3AED',
    },
    {
      route: '/screenshot-clean',
      icon: 'camera.viewfinder' as const,
      title: '截图 & 临时图片',
      sub: '自动整理截图、聊天转发图，多选后一键删除',
      badge: summary ? `${summary.screenshotCount} 张` : null,
      badgeColor: '#0EA5E9',
    },
    {
      route: '/deep-clean',
      icon: 'wand.and.stars' as const,
      title: '全相册深度体检',
      sub: '综合清理模糊照片、连拍废片和杂乱图片',
      badge: null,
      badgeColor: '#10B981',
    },
  ] as const, [summary]);

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
      showsVerticalScrollIndicator={false}>

      {/* ── Hero card ── */}
      <ThemedView style={[styles.heroCard, { backgroundColor: cardBg }]}>

        {/* Storage stat row */}
        <View style={styles.statRow}>
          <View style={styles.statItem}>
            <ThemedText style={[styles.statValue, { color: accentText }]}>
              {statsLoading ? '–' : stats.usedLabel}
            </ThemedText>
            <ThemedText style={styles.statLabel}>照片占用</ThemedText>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <ThemedText style={[styles.statValue, { color: '#10B981' }]}>
              {stats.freedBytes > 0
                ? (stats.freedBytes >= 1024 ** 3
                  ? `${(stats.freedBytes / 1024 ** 3).toFixed(1)} GB`
                  : `${(stats.freedBytes / 1024 ** 2).toFixed(0)} MB`)
                : '0 MB'}
            </ThemedText>
            <ThemedText style={styles.statLabel}>已释放</ThemedText>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <ThemedText style={[styles.statValue, { color: '#F59E0B' }]}>
              {statsLoading ? '–' : stats.totalPhotos.toLocaleString()}
            </ThemedText>
            <ThemedText style={styles.statLabel}>张照片</ThemedText>
          </View>
        </View>

        {/* Pet */}
        <View style={styles.petArea}>
          <PetAvatar
            fillRatio={stats.fillRatio}
            freedBytes={triggerFreed}
            size={130}
          />
        </View>

        {/* Scan button + progress */}
        {scanStatus === 'scanning' ? (
          <View style={styles.scanningBox}>
            {scanSteps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                {step.done
                  ? <ThemedText style={styles.stepDone}>✓</ThemedText>
                  : i === scanSteps.findIndex((s) => !s.done)
                    ? <ActivityIndicator size="small" color={accentText} style={{ width: 18 }} />
                    : <View style={styles.stepDot} />}
                <ThemedText style={[styles.stepLabel, step.done && { color: '#10B981' }]}>
                  {step.label}
                </ThemedText>
              </View>
            ))}
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressBar, progressStyle, { backgroundColor: accentText }]} />
            </View>
          </View>
        ) : (
          <Pressable
            style={[styles.primaryButton, { backgroundColor: accentText }]}
            onPress={scanPhotos}>
            <ThemedText style={styles.primaryButtonText}>
              {scanStatus === 'done' ? '重新扫描' : '开始快速扫描'}
            </ThemedText>
          </Pressable>
        )}
      </ThemedView>

      {/* ── Section header ── */}
      <View style={styles.sectionHeader}>
        <ThemedText type="subtitle">智能清理</ThemedText>
        {summary && (
          <ThemedText style={styles.sectionHint}>
            共发现 {summary.similarPhotos + summary.screenshotCount} 张可清理
          </ThemedText>
        )}
      </View>

      {/* ── Feature cards ── */}
      {features.map((feat) => (
        <Pressable
          key={feat.route}
          style={[styles.featureCard, { backgroundColor: featBg }]}
          onPress={() => {
            if (!handleEnsurePermission()) return;
            router.push(feat.route);
          }}>
          <View style={[styles.featureIconBox, { backgroundColor: feat.badgeColor + '22' }]}>
            <IconSymbol name={feat.icon} size={26} color={feat.badgeColor} />
          </View>
          <View style={styles.featureTextArea}>
            <View style={styles.featureTitleRow}>
              <ThemedText type="defaultSemiBold">{feat.title}</ThemedText>
              {feat.badge && (
                <View style={[styles.badge, { backgroundColor: feat.badgeColor + '22' }]}>
                  <ThemedText style={[styles.badgeText, { color: feat.badgeColor }]}>
                    {feat.badge}
                  </ThemedText>
                </View>
              )}
            </View>
            <ThemedText style={styles.featureSub}>{feat.sub}</ThemedText>
          </View>
          <IconSymbol name="chevron.right" size={16} color="#9CA3AF" />
        </Pressable>
      ))}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  heroCard: {
    borderRadius: 24,
    padding: 20,
    gap: 16,
    overflow: 'visible',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#374151',
    opacity: 0.4,
  },
  petArea: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 0,
    height: 210,
  },
  primaryButton: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scanningBox: {
    gap: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#4B5563',
  },
  stepDone: {
    width: 18,
    textAlign: 'center',
    fontSize: 13,
    color: '#10B981',
  },
  stepLabel: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#374151',
    overflow: 'hidden',
    marginTop: 4,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionHint: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  featureCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  featureIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTextArea: {
    flex: 1,
    gap: 3,
  },
  featureTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureSub: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 17,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
