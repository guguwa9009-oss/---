import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import { useNavigation } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type Candidate = MediaLibrary.Asset & {
  reason: string;
  selected?: boolean;
};

export default function DeepCleanScreen() {
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<Candidate[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<Candidate | null>(null);
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions?.({ title: '深度体检' });
  }, [navigation]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await MediaLibrary.getPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('需要相册权限', '请在设置中开启相册访问权限后重试。');
          setLoading(false);
          return;
        }

        const page = await MediaLibrary.getAssetsAsync({
          mediaType: ['photo'],
          sortBy: [['creationTime', false]],
          first: 3000,
        });

        const now = Date.now();
        const candidates: Candidate[] = [];

        for (const asset of page.assets) {
          const created = asset.creationTime ?? now;
          const ageDays = (now - created) / (1000 * 60 * 60 * 24);
          const area = (asset.width ?? 0) * (asset.height ?? 0);
          const size = asset.fileSize ?? 0;

          // 规则 1：很久以前的小图，疑似缩略图/聊天转发图
          if (ageDays > 180 && area < 800 * 800) {
            candidates.push({
              ...asset,
              reason: '半年以前的小图，可能是聊天转发或缩略图',
              selected: true,
            });
            continue;
          }

          // 规则 2：极小尺寸/异常比例的图片
          const ratio = asset.height && asset.width ? asset.height / asset.width : 0;
          if (area < 400 * 400 || ratio > 3 || ratio < 0.3) {
            candidates.push({
              ...asset,
              reason: '尺寸或比例异常，可能是裁剪残片或无效截图',
              selected: true,
            });
            continue;
          }

          // 规则 3：文件特别大的老照片，优先建议清理
          if (ageDays > 365 && size > 8 * 1024 * 1024) {
            candidates.push({
              ...asset,
              reason: '一年前的大文件照片，可以考虑备份到云端后删除本地',
              selected: false,
            });
          }
        }

        setAssets(candidates);
      } catch (e) {
        console.error(e);
        Alert.alert('扫描失败', '深度体检时出错，请稍后重试。');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a)));
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    const toDelete = assets.filter((a) => a.selected).map((a) => a.id);
    if (!toDelete.length || deleting) return;

    Alert.alert('确认删除', `将删除选中的 ${toDelete.length} 张图片，确定吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            setDeleting(true);
            await MediaLibrary.deleteAssetsAsync(toDelete);
            setAssets((prev) => prev.filter((a) => !toDelete.includes(a.id)));
          } catch (e) {
            console.error(e);
            Alert.alert('删除失败', '删除图片时出错，请稍后重试。');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }, [assets, deleting]);

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
        <ThemedText style={styles.centerText}>正在对相册进行深度体检…</ThemedText>
      </ThemedView>
    );
  }

  if (!assets.length) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="title">相册状态良好</ThemedText>
        <ThemedText style={styles.centerText}>没有明显需要清理的模糊/杂乱图片。</ThemedText>
      </ThemedView>
    );
  }

  const selectedCount = assets.filter((a) => a.selected).length;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.toolbar}>
        <ThemedText>
          已选 {selectedCount} / {assets.length} 张
        </ThemedText>
        <Pressable
          style={[styles.deleteButton, !selectedCount && { opacity: 0.5 }]}
          disabled={!selectedCount || deleting}
          onPress={handleDeleteSelected}>
          <ThemedText style={styles.deleteButtonText}>
            {deleting ? '正在删除…' : '删除选中'}
          </ThemedText>
        </Pressable>
      </View>

      {previewAsset && (
        <Modal transparent animationType="fade">
          <Pressable style={styles.previewBackdrop} onPress={() => setPreviewAsset(null)}>
            <Image
              source={{ uri: previewAsset.uri }}
              style={styles.previewImage}
              contentFit="contain"
            />
          </Pressable>
        </Modal>
      )}

      <FlatList
        data={assets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => (
          <Pressable
            style={styles.itemRow}
            onPress={() => toggleSelect(item.id)}
            onLongPress={() => setPreviewAsset(item)}>
            <Image source={{ uri: item.uri }} style={styles.thumbnail} contentFit="cover" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <ThemedText numberOfLines={2} style={styles.reason}>
                {item.reason}
              </ThemedText>
            </View>
            {item.selected && <View style={styles.selectedMark} />}
          </Pressable>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  centerText: {
    textAlign: 'center',
  },
  toolbar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  deleteButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#DC2626',
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#111827',
    marginBottom: 4,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: '#1f2933',
  },
  reason: {
    fontSize: 13,
    color: '#D1D5DB',
  },
  selectedMark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#3B82F6',
    marginLeft: 8,
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '90%',
    height: '80%',
    borderRadius: 16,
  },
});

