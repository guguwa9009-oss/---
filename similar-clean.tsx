import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { GestureHandlerRootView, RectButton, Swipeable } from 'react-native-gesture-handler';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import { useNavigation } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { storageEvent } from '@/hooks/storage-event';

type Group = {
  id: string;
  assets: MediaLibrary.Asset[];
  keepIds: string[];
};

type Strictness = 'strict' | 'medium' | 'loose';

const MODE_DESC: Record<Strictness, string> = {
  strict: '相似度 ≥ 70% · 15分钟内集中拍摄',
  medium: '相似度 ≥ 60% · 15分钟内集中拍摄',
  loose:  '相似度 ≥ 50% · 15分钟内集中拍摄',
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function calcDeletableBytes(groups: Group[]): number {
  let total = 0;
  for (const g of groups) {
    for (const a of g.assets) {
      if (!g.keepIds.includes(a.id) && a.fileSize) total += a.fileSize;
    }
  }
  return total;
}

// ── Swipeable row ─────────────────────────────────────────────────────────────
// 左滑 = 全部删除（一张不留，包括"保留"的那张）
// 右滑 = 永久忽略（本次和下次扫描都不再显示）
function GroupRow({
  item,
  deleting,
  onDelete,
  onIgnore,
  onToggleKeep,
  onLongPress,
}: {
  item: Group;
  deleting: boolean;
  onDelete: (g: Group, fromSwipe?: boolean) => void;
  onIgnore: (id: string) => void;
  onToggleKeep: (groupId: string, assetId: string) => void;
  onLongPress: (groupId: string, idx: number) => void;
}) {
  const swipeRef = useRef<Swipeable>(null);

  const keepCount = item.keepIds.length;
  const deleteCount = item.assets.length - keepCount;
  const deletableBytes = item.assets
    .filter((a) => !item.keepIds.includes(a.id))
    .reduce((s, a) => s + (a.fileSize ?? 0), 0);

  // 左滑显示"全部删除"（红色，在右侧出现）
  const renderRightActions = () => (
    <RectButton
      style={styles.swipeDeleteBg}
      onPress={() => {
        swipeRef.current?.close();
        onDelete(item, true);
      }}>
      <ThemedText style={styles.swipeActionText}>全部删除</ThemedText>
    </RectButton>
  );

  // 右滑显示"忽略本组"（灰色，在左侧出现）
  const renderLeftActions = () => (
    <RectButton
      style={styles.swipeIgnoreBg}
      onPress={() => {
        swipeRef.current?.close();
        onIgnore(item.id);
      }}>
      <ThemedText style={styles.swipeActionText}>忽略本组</ThemedText>
    </RectButton>
  );

  return (
    <Swipeable
      ref={swipeRef}
      friction={1.5}
      leftThreshold={60}
      rightThreshold={60}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}>
      <View style={styles.groupCard}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbStrip}>
          {item.assets.map((asset, idx) => {
            const isKept = item.keepIds.includes(asset.id);
            return (
              <Pressable
                key={asset.id}
                style={styles.thumbWrapper}
                onPress={() => onToggleKeep(item.id, asset.id)}
                onLongPress={() => onLongPress(item.id, idx)}>
                <Image
                  source={{ uri: asset.uri }}
                  style={[styles.thumbImage, !isKept && styles.thumbImageDimmed]}
                  contentFit="cover"
                />
                {isKept ? (
                  <View style={styles.keepBadge}>
                    <ThemedText style={styles.keepBadgeText}>保留</ThemedText>
                  </View>
                ) : (
                  <View style={styles.deleteBadge}>
                    <ThemedText style={styles.deleteBadgeText}>×</ThemedText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.groupInfoRow}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.groupInfoMain}>
              {keepCount === 0
                ? '全部删除'
                : `保留 ${keepCount} 张 · 清理 ${deleteCount} 张`}
            </ThemedText>
            {deletableBytes > 0 && (
              <ThemedText style={styles.groupInfoSub}>
                可释放 {formatBytes(deletableBytes)}
              </ThemedText>
            )}
          </View>
          <Pressable
            style={[styles.cleanBtn, deleteCount === 0 && { opacity: 0.4 }]}
            onPress={() => onDelete(item)}
            disabled={deleteCount === 0 || deleting}>
            <ThemedText style={styles.cleanBtnText}>清理本组</ThemedText>
          </Pressable>
        </View>
      </View>
    </Swipeable>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SimilarCleanScreen() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  // useRef so ignored groups persist across mode switches and re-scans
  const ignoredIdsRef = useRef<Set<string>>(new Set());
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [freedBytes, setFreedBytes] = useState(0);
  const [strictness, setStrictness] = useState<Strictness>('strict');
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [allGroupsSelected, setAllGroupsSelected] = useState(false);
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions?.({ title: '相似照片清理' });
  }, [navigation]);

  const analyzeSimilarPhotos = useCallback(async (mode: Strictness) => {
    try {
      setLoading(true);
      const { status } = await MediaLibrary.getPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要相册权限', '请在设置中开启相册访问权限后重试。');
        setLoading(false);
        return;
      }

      const page = await MediaLibrary.getAssetsAsync({
        mediaType: ['photo'],
        sortBy: [['creationTime', false]],
        first: 2000,
      });

      const sorted = page.assets
        .filter((a) => a.creationTime != null)
        .sort((a, b) => (a.creationTime ?? 0) - (b.creationTime ?? 0));

      const maxGapMs = 15 * 60 * 1000;
      const timeClusters: MediaLibrary.Asset[][] = [];
      for (const asset of sorted) {
        const t = asset.creationTime ?? 0;
        const last = timeClusters[timeClusters.length - 1];
        if (!last || t - (last[last.length - 1].creationTime ?? 0) > maxGapMs) {
          timeClusters.push([asset]);
        } else {
          last.push(asset);
        }
      }

      const groupsResult: Group[] = [];
      let groupIndex = 0;
      const requireSameLocation = mode === 'strict';
      const similarityThreshold = mode === 'strict' ? 0.7 : mode === 'medium' ? 0.6 : 0.5;

      for (const cluster of timeClusters) {
        const byKey: Record<string, MediaLibrary.Asset[]> = {};
        for (const asset of cluster) {
          const key = `${asset.width}x${asset.height}`;
          if (!byKey[key]) byKey[key] = [];
          byKey[key].push(asset);
        }

        Object.values(byKey).forEach((group) => {
          if (group.length < 2) return;

          let candidateGroup: MediaLibrary.Asset[];
          if (requireSameLocation) {
            const base = group[0];
            const baseLoc = base.location;
            const same = group.filter((asset) => {
              if (!baseLoc || !asset.location) return false;
              return (
                Math.abs((asset.location.latitude ?? 0) - (baseLoc.latitude ?? 0)) < 0.001 &&
                Math.abs((asset.location.longitude ?? 0) - (baseLoc.longitude ?? 0)) < 0.001
              );
            });
            if (same.length < 2) return;
            candidateGroup = same;
          } else {
            candidateGroup = group;
          }

          candidateGroup.sort((a, b) => {
            const sA = (a.width ?? 0) * (a.height ?? 0) * 0.7 + (a.fileSize ?? 0) * 0.3;
            const sB = (b.width ?? 0) * (b.height ?? 0) * 0.7 + (b.fileSize ?? 0) * 0.3;
            return sB - sA;
          });

          const keep = candidateGroup[0];
          const deletes: MediaLibrary.Asset[] = [];
          for (let i = 1; i < candidateGroup.length; i++) {
            const asset = candidateGroup[i];
            const baseSize = keep.fileSize ?? 0;
            if (!baseSize || !asset.fileSize) {
              if (mode !== 'strict') deletes.push(asset);
              continue;
            }
            const ratio = Math.min(baseSize, asset.fileSize) / Math.max(baseSize, asset.fileSize);
            if (ratio >= similarityThreshold) deletes.push(asset);
          }
          if (deletes.length === 0) return;

          const deleteIds = deletes.map((d) => d.id);
          const keepIds = candidateGroup.map((a) => a.id).filter((id) => !deleteIds.includes(id));

          groupsResult.push({
            id: `g-${groupIndex++}`,
            assets: candidateGroup,
            keepIds: keepIds.length ? keepIds : [candidateGroup[0].id],
          });
        });
      }

      setGroups(groupsResult);
      setAllGroupsSelected(false);
    } catch (e) {
      console.error(e);
      Alert.alert('分析失败', '相似照片识别时出错，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    analyzeSimilarPhotos(strictness);
  }, [analyzeSimilarPhotos, strictness]);

  const visibleGroups = useMemo(
    () => groups.filter((g) => !ignoredIdsRef.current.has(g.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, ignoredIds] // ignoredIds triggers re-render, ref has the actual set
  );

  const totalDeletable = useMemo(
    () => visibleGroups.reduce((sum, g) => sum + g.assets.length - g.keepIds.length, 0),
    [visibleGroups]
  );

  const estimatedBytes = useMemo(() => calcDeletableBytes(visibleGroups), [visibleGroups]);

  const toggleKeepInGroup = useCallback((groupId: string, assetId: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const alreadyKeep = g.keepIds.includes(assetId);
        return {
          ...g,
          keepIds: alreadyKeep
            ? g.keepIds.filter((id) => id !== assetId)
            : [...g.keepIds, assetId],
        };
      })
    );
  }, []);

  const handleIgnoreGroup = useCallback((groupId: string) => {
    // Store by groupId for current session
    ignoredIdsRef.current.add(groupId);
    setIgnoredIds(new Set(ignoredIdsRef.current));
  }, []);

  const doDelete = useCallback(async (deleteIds: string[], freedNow: number, groupId: string) => {
    try {
      setDeleting(true);
      await MediaLibrary.deleteAssetsAsync(deleteIds);
      setFreedBytes((prev) => prev + freedNow);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      storageEvent.emit();
    } catch (e) {
      console.error(e);
      Alert.alert('删除失败', '删除照片时出错，请稍后重试。');
    } finally {
      setDeleting(false);
    }
  }, []);

  const handleCleanGroup = useCallback(async (group: Group, fromSwipe = false) => {
    if (deleting) return;

    if (fromSwipe) {
      // 左滑：全组一张不留，包括"保留"的那张
      const allIds = group.assets.map((a) => a.id);
      const freedNow = group.assets.reduce((s, a) => s + (a.fileSize ?? 0), 0);
      doDelete(allIds, freedNow, group.id);
      return;
    }

    // 按钮点击：只删除标记为"删除"的，保留用户勾选的
    const deleteIds = group.assets
      .filter((a) => !group.keepIds.includes(a.id))
      .map((a) => a.id);
    if (!deleteIds.length) return;

    const freedNow = group.assets
      .filter((a) => deleteIds.includes(a.id))
      .reduce((s, a) => s + (a.fileSize ?? 0), 0);

    Alert.alert(
      '确认删除',
      group.keepIds.length === 0
        ? `将删除本组全部 ${deleteIds.length} 张照片，确定吗？`
        : `将删除本组 ${deleteIds.length} 张照片，确定吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => doDelete(deleteIds, freedNow, group.id),
        },
      ]
    );
  }, [deleting, doDelete]);

  const handleToggleSelectAll = useCallback(() => {
    setAllGroupsSelected((prev) => {
      const next = !prev;
      setGroups((gs) => gs.map((g) => ({ ...g, keepIds: [g.assets[0].id] })));
      return next;
    });
  }, []);

  const handleDeleteAll = useCallback(async () => {
    const toDelete = visibleGroups.flatMap((g) =>
      g.assets.filter((a) => !g.keepIds.includes(a.id)).map((a) => a.id)
    );
    if (!toDelete.length || deleting) return;

    Alert.alert(
      '确认批量删除',
      `将清理 ${visibleGroups.length} 组中共 ${toDelete.length} 张重复照片，每组保留最清晰的一张。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '全部删除',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              const freedNow = calcDeletableBytes(visibleGroups);
              await MediaLibrary.deleteAssetsAsync(toDelete);
              setFreedBytes((prev) => prev + freedNow);
              setGroups([]);
              storageEvent.emit();
            } catch (e) {
              console.error(e);
              Alert.alert('删除失败', '删除照片时出错，请稍后重试。');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  }, [visibleGroups, deleting]);

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color="#7C3AED" />
        <ThemedText style={styles.centerText}>正在分析相似照片…</ThemedText>
      </ThemedView>
    );
  }

  const ModeBar = () => (
    <View style={styles.modeBarWrapper}>
      <View style={styles.modeBar}>
        <ThemedText style={styles.modeLabel}>筛选模式</ThemedText>
        <View style={styles.modeButtons}>
          {(['strict', 'medium', 'loose'] as Strictness[]).map((key) => {
            const label = key === 'strict' ? '严格' : key === 'medium' ? '标准' : '宽松';
            const active = strictness === key;
            return (
              <Pressable
                key={key}
                style={[styles.modeButton, active && styles.modeButtonActive]}
                onPress={() => setStrictness(key)}>
                <ThemedText style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>
      <ThemedText style={styles.modeDesc}>{MODE_DESC[strictness]}</ThemedText>
    </View>
  );

  if (!visibleGroups.length) {
    return (
      <ThemedView style={styles.container}>
        <ModeBar />
        <View style={styles.center}>
          <ThemedText style={{ fontSize: 56, lineHeight: 68, textAlign: 'center' }}>🎉</ThemedText>
          <ThemedText type="title" style={{ textAlign: 'center' }}>照片整洁！</ThemedText>
          <ThemedText style={styles.centerText}>
            {strictness !== 'loose' ? '换个宽松模式试试？' : '相册里没有相似照片了。'}
          </ThemedText>
          {freedBytes > 0 && (
            <View style={styles.freedBanner}>
              <ThemedText style={styles.freedBannerText}>
                本次已释放 {formatBytes(freedBytes)}
              </ThemedText>
            </View>
          )}
        </View>
      </ThemedView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemedView style={styles.container}>
        <ModeBar />

        <View style={styles.toolbar}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.toolbarTitle}>
              {visibleGroups.length} 组 · 可清理 {totalDeletable} 张
            </ThemedText>
            {estimatedBytes > 0 && (
              <ThemedText style={styles.toolbarSub}>
                约释放 {formatBytes(estimatedBytes)}
              </ThemedText>
            )}
          </View>
          <Pressable style={styles.selectAllBtn} onPress={handleToggleSelectAll}>
            <ThemedText style={styles.selectAllText}>
              {allGroupsSelected ? '取消全选' : '全选删除'}
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.deleteAllBtn, !totalDeletable && { opacity: 0.4 }]}
            disabled={!totalDeletable || deleting}
            onPress={handleDeleteAll}>
            <ThemedText style={styles.deleteAllText}>
              {deleting ? '删除中…' : '一键清理'}
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.swipeHintRow}>
          <ThemedText style={styles.swipeHintLabel}>← 左滑删除本组 · 右滑忽略本组 →</ThemedText>
        </View>

        {freedBytes > 0 && (
          <View style={styles.freedBanner}>
            <ThemedText style={styles.freedBannerText}>
              已释放 {formatBytes(freedBytes)}
            </ThemedText>
          </View>
        )}

        {previewGroupId && (
          <Modal transparent animationType="fade">
            <View style={styles.previewBackdrop}>
              {(() => {
                const group = groups.find((g) => g.id === previewGroupId);
                if (!group) return null;
                return (
                  <>
                    <FlatList
                      data={group.assets}
                      keyExtractor={(item) => item.id}
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      initialScrollIndex={previewIndex}
                      getItemLayout={(_, index) => {
                        const w = Dimensions.get('window').width;
                        return { length: w, offset: w * index, index };
                      }}
                      onMomentumScrollEnd={(e) => {
                        const w = Dimensions.get('window').width;
                        setPreviewIndex(Math.round(e.nativeEvent.contentOffset.x / w));
                      }}
                      renderItem={({ item }) => {
                        const isKept = group.keepIds.includes(item.id);
                        return (
                          <Pressable
                            style={styles.previewSlide}
                            onPress={() => setPreviewGroupId(null)}>
                            <Image
                              source={{ uri: item.uri }}
                              style={styles.previewImage}
                              contentFit="contain"
                            />
                            <Pressable
                              style={[styles.previewKeepDot, isKept && styles.previewKeepDotActive]}
                              onPress={(e) => {
                                e.stopPropagation();
                                toggleKeepInGroup(group.id, item.id);
                              }}>
                              {isKept && (
                                <ThemedText style={styles.previewKeepDotText}>✓</ThemedText>
                              )}
                            </Pressable>
                          </Pressable>
                        );
                      }}
                    />
                    {/* Back hint */}
                    <Pressable style={styles.previewClose} onPress={() => setPreviewGroupId(null)}>
                      <ThemedText style={styles.previewCloseText}>← 返回</ThemedText>
                    </Pressable>
                  </>
                );
              })()}
            </View>
          </Modal>
        )}

        <FlatList
          data={visibleGroups}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <GroupRow
              item={item}
              deleting={deleting}
              onDelete={handleCleanGroup}
              onIgnore={handleIgnoreGroup}
              onToggleKeep={toggleKeepInGroup}
              onLongPress={(groupId, idx) => {
                setPreviewGroupId(groupId);
                setPreviewIndex(idx);
              }}
            />
          )}
        />
      </ThemedView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  centerText: { textAlign: 'center', color: '#9CA3AF', marginTop: 4 },

  modeBarWrapper: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 4,
  },
  modeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modeLabel: { fontSize: 14 },
  modeButtons: { flexDirection: 'row', gap: 8 },
  modeButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4B5563',
  },
  modeButtonActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  modeButtonText: { fontSize: 13, color: '#9CA3AF' },
  modeButtonTextActive: { color: '#FFFFFF' },
  modeDesc: { fontSize: 11, color: '#6B7280', paddingLeft: 2 },

  toolbar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolbarTitle: { fontSize: 13, fontWeight: '600' },
  toolbarSub: { fontSize: 11, color: '#10B981', marginTop: 1 },
  selectAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#7C3AED',
  },
  selectAllText: { fontSize: 12, color: '#7C3AED' },
  deleteAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#DC2626',
  },
  deleteAllText: { fontSize: 12, color: '#fff', fontWeight: '600' },

  swipeHintRow: { paddingHorizontal: 16, paddingBottom: 6 },
  swipeHintLabel: { fontSize: 11, color: '#6B7280', textAlign: 'center' },

  freedBanner: {
    marginHorizontal: 16,
    marginBottom: 6,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#052E16',
    alignItems: 'center',
  },
  freedBannerText: { color: '#10B981', fontSize: 13, fontWeight: '600' },

  swipeDeleteBg: {
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    borderRadius: 16,
  },
  swipeIgnoreBg: {
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    borderRadius: 16,
  },
  swipeActionText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  groupCard: {
    borderRadius: 16,
    backgroundColor: '#111827',
    overflow: 'hidden',
  },
  thumbStrip: { padding: 10, gap: 6 },
  thumbWrapper: {
    position: 'relative',
    width: 90,
    height: 90,
    borderRadius: 10,
    overflow: 'hidden',
  },
  thumbImage: {
    width: 90,
    height: 90,
    borderRadius: 10,
    backgroundColor: '#1f2933',
  },
  thumbImageDimmed: { opacity: 0.4 },
  keepBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: '#059669',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  keepBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  deleteBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(220,38,38,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 },

  groupInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1F2937',
    gap: 8,
  },
  groupInfoMain: { fontSize: 13, fontWeight: '600', color: '#E5E7EB' },
  groupInfoSub: { fontSize: 11, color: '#10B981', marginTop: 1 },
  cleanBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#DC2626',
  },
  cleanBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewSlide: {
    width: Dimensions.get('window').width,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: Dimensions.get('window').width * 0.9,
    height: Dimensions.get('window').height * 0.72,
    borderRadius: 16,
  },
  previewKeepDot: {
    marginTop: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  previewKeepDotActive: { backgroundColor: '#10B981', borderColor: '#10B981' },
  previewKeepDotText: { color: '#fff', fontSize: 18 },
  previewClose: {
    position: 'absolute',
    top: 52,
    left: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.9)',
  },
  previewCloseText: { color: '#F9FAFB', fontSize: 14 },
});
