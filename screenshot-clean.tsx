import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import { useNavigation } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type SelectableAsset = MediaLibrary.Asset & { selected?: boolean };

export default function ScreenshotCleanScreen() {
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<SelectableAsset[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<SelectableAsset | null>(null);
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions?.({ title: '截图清理' });
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
          first: 2000,
        });

        const screenshots = page.assets.filter((asset) => {
          const lowerName = (asset.filename ?? '').toLowerCase();
          const isByName =
            lowerName.includes('screenshot') || lowerName.includes('screen') || lowerName.includes('屏幕快照');
          const isBySubtype =
            Array.isArray(asset.mediaSubtypes) &&
            asset.mediaSubtypes.some((s) => s.toLowerCase().includes('screenshot'));
          const ratio = asset.height && asset.width ? asset.height / asset.width : 0;
          const isByRatio = ratio > 1.7;
          return isByName || isBySubtype || isByRatio;
        });

        setAssets(
          screenshots.map((a) => ({
            ...a,
            selected: true,
          })),
        );
      } catch (e) {
        console.error(e);
        Alert.alert('扫描失败', '识别截图时出错，请稍后重试。');
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

    Alert.alert('确认删除', `将删除选中的 ${toDelete.length} 张截图，确定吗？`, [
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
            Alert.alert('删除失败', '删除截图时出错，请稍后重试。');
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
        <ThemedText style={styles.centerText}>正在识别截图和临时图片…</ThemedText>
      </ThemedView>
    );
  }

  if (!assets.length) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="title">暂时没有需要清理的截图</ThemedText>
        <ThemedText style={styles.centerText}>以后可以随时回来再整理。</ThemedText>
      </ThemedView>
    );
  }

  const selectedCount = assets.filter((a) => a.selected).length;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.toolbar}>
        <ThemedText>
          已选 {selectedCount} / {assets.length} 张截图
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
        numColumns={3}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <Pressable
            style={styles.gridItem}
            onPress={() => toggleSelect(item.id)}
            onLongPress={() => setPreviewAsset(item)}>
            <Image source={{ uri: item.uri }} style={styles.image} contentFit="cover" />
            {item.selected && <View style={styles.selectedOverlay} />}
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
  grid: {
    paddingHorizontal: 4,
    paddingBottom: 12,
  },
  gridItem: {
    flex: 1 / 3,
    aspectRatio: 9 / 16,
    padding: 4,
  },
  image: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#111827',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#3B82F6',
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

