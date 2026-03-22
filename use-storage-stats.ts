import { useCallback, useEffect, useRef, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';

export type StorageStats = {
  usedBytes: number;
  totalPhotos: number;
  freedBytes: number;
  usedLabel: string;
  fillRatio: number;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// 用照片数量估算占用：平均每张 3.5 MB（iPhone 实拍约 4-6MB，截图/转发图约 1MB，取中间值）
const AVG_BYTES_PER_PHOTO = 3.5 * 1024 * 1024;

// fillRatio 参考上限：1万张照片 = 满状态
const MAX_PHOTOS_REFERENCE = 10000;

export function useStorageStats() {
  const [stats, setStats] = useState<StorageStats>({
    usedBytes: 0,
    totalPhotos: 0,
    freedBytes: 0,
    usedLabel: '计算中…',
    fillRatio: 0.3,
  });
  const [loading, setLoading] = useState(true);
  const baselinePhotosRef = useRef<number | null>(null);
  const baselineBytesRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { status } = await MediaLibrary.getPermissionsAsync();
      if (status !== 'granted') {
        setLoading(false);
        return;
      }

      // 只取第一页拿 totalCount，不需要遍历所有资产
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: ['photo', 'video'],
        first: 1,
      });

      const totalPhotos = page.totalCount;

      // 用数量估算大小
      const estimatedBytes = Math.round(totalPhotos * AVG_BYTES_PER_PHOTO);

      if (baselinePhotosRef.current === null) {
        baselinePhotosRef.current = totalPhotos;
        baselineBytesRef.current = estimatedBytes;
      }

      const freedBytes = Math.max(
        0,
        Math.round((baselinePhotosRef.current - totalPhotos) * AVG_BYTES_PER_PHOTO)
      );

      // fillRatio：照片数 / 参考上限，最低 0.05 保证宠物不会完全消失
      const fillRatio = Math.min(1, Math.max(0.05, totalPhotos / MAX_PHOTOS_REFERENCE));

      setStats({
        usedBytes: estimatedBytes,
        totalPhotos,
        freedBytes,
        usedLabel: formatBytes(estimatedBytes),
        fillRatio,
      });
    } catch (e) {
      console.error('useStorageStats:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stats, loading, refresh };
}
