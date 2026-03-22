import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, { Ellipse, Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ThemedText } from '@/components/themed-text';

export type PetMood = 'stuffed' | 'chubby' | 'normal' | 'slim';

interface PetAvatarProps {
  fillRatio: number;
  freedBytes: number;
  speechText?: string;
  size?: number;
}

function getMood(fillRatio: number): PetMood {
  if (fillRatio >= 0.7) return 'stuffed';
  if (fillRatio >= 0.45) return 'chubby';
  if (fillRatio >= 0.2) return 'normal';
  return 'slim';
}

const MOOD_LINES: Record<PetMood, string[]> = {
  stuffed: ['我好撑啊…', '快帮我减减肥！', '照片太多了呜呜', '肚子都要撑破啦'],
  chubby:  ['可以再清理一些～', '我还有点重…', '帮我多瘦一点吧', '再清理几组就好啦'],
  normal:  ['状态不错！', '继续保持哦', '你很棒！', '我感觉轻多了'],
  slim:    ['我超轻盈！', '太爽了！', '谢谢你帮我减肥！', '相册好整洁～'],
};

function pickLine(mood: PetMood, freedBytes: number): string {
  if (freedBytes > 0) {
    // 1MB ≈ 1048576 bytes, show as grams (1MB → ~1g, fun unit)
    const grams = Math.max(1, Math.round(freedBytes / (1024 * 1024)));
    return `又瘦了 ${grams} 克！`;
  }
  const lines = MOOD_LINES[mood];
  return lines[Math.floor(Date.now() / 10000) % lines.length];
}

function PetSVG({ mood, size }: { mood: PetMood; size: number }) {
  const configs = {
    stuffed: { bodyRx: 78, bodyRy: 62, bodyY: 66, cheekScale: 1.2 },
    chubby:  { bodyRx: 68, bodyRy: 54, bodyY: 68, cheekScale: 1.0 },
    normal:  { bodyRx: 56, bodyRy: 46, bodyY: 72, cheekScale: 0.8 },
    slim:    { bodyRx: 44, bodyRy: 40, bodyY: 74, cheekScale: 0.65 },
  };
  const { bodyRx, bodyRy, bodyY, cheekScale } = configs[mood];
  const cx = size / 2;
  const s = size / 160;

  const eyeY = (bodyY - bodyRy * 0.25) * s;
  const eyeOffX = 20 * s;
  const eyeR = 9 * s;
  const pupilR = 6.5 * s;
  const noseY = (bodyY + 4) * s;
  const mouthY = (bodyY + 16) * s;
  const cheekOffX = 34 * cheekScale * s;
  const cheekOffY = 8 * cheekScale * s;
  const cheekRx = 14 * cheekScale * s;
  const cheekRy = 8 * cheekScale * s;
  const earOffX = bodyRx * 0.72 * s;
  const earOffY = (bodyY - bodyRy * 0.85) * s;
  const earRx = 12 * s;
  const earRy = 15 * s;
  const bRx = bodyRx * s;
  const bRy = bodyRy * s;
  const bCY = bodyY * s;
  const showTummy = mood === 'stuffed' || mood === 'chubby';
  const tummyRx = bodyRx * 0.45 * s;
  const tummyRy = bodyRy * 0.38 * s;
  const tummyY = (bodyY + bodyRy * 0.2) * s;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Shadow */}
      <Ellipse cx={cx} cy={size * 0.92} rx={bRx * 0.8} ry={8 * s} fill="rgba(0,0,0,0.10)" />
      {/* Ears — square with rounded corners */}
      <Rect x={cx - earOffX - earRx} y={earOffY - earRy} width={earRx * 2} height={earRy * 2} rx={earRx * 0.35} fill="#F4A8C0" />
      <Rect x={cx + earOffX - earRx} y={earOffY - earRy} width={earRx * 2} height={earRy * 2} rx={earRx * 0.35} fill="#F4A8C0" />
      <Rect x={cx - earOffX - earRx * 0.55} y={earOffY - earRy * 0.6} width={earRx * 1.1} height={earRy * 1.2} rx={earRx * 0.2} fill="#FFD6E8" />
      <Rect x={cx + earOffX - earRx * 0.55} y={earOffY - earRy * 0.6} width={earRx * 1.1} height={earRy * 1.2} rx={earRx * 0.2} fill="#FFD6E8" />
      {/* Body */}
      <Ellipse cx={cx} cy={bCY} rx={bRx} ry={bRy} fill="#FFDEE9" />
      {/* Tummy */}
      {showTummy && (
        <Ellipse cx={cx} cy={tummyY} rx={tummyRx} ry={tummyRy} fill="rgba(255,255,255,0.45)" />
      )}
      {/* Cheeks */}
      <Ellipse cx={cx - cheekOffX} cy={eyeY + cheekOffY} rx={cheekRx} ry={cheekRy} fill="#FFB3C6" opacity={0.7} />
      <Ellipse cx={cx + cheekOffX} cy={eyeY + cheekOffY} rx={cheekRx} ry={cheekRy} fill="#FFB3C6" opacity={0.7} />
      {/* Eye whites */}
      <Ellipse cx={cx - eyeOffX} cy={eyeY} rx={eyeR} ry={eyeR * 1.1} fill="#fff" />
      <Ellipse cx={cx + eyeOffX} cy={eyeY} rx={eyeR} ry={eyeR * 1.1} fill="#fff" />
      {/* Pupils */}
      <Ellipse cx={cx - eyeOffX + 1 * s} cy={eyeY + 1 * s} rx={pupilR} ry={pupilR * 1.1} fill="#2D1B69" />
      <Ellipse cx={cx + eyeOffX + 1 * s} cy={eyeY + 1 * s} rx={pupilR} ry={pupilR * 1.1} fill="#2D1B69" />
      {/* Eye shine */}
      <Ellipse cx={cx - eyeOffX + 2 * s} cy={eyeY - 1.5 * s} rx={1.8 * s} ry={1.8 * s} fill="#fff" opacity={0.9} />
      <Ellipse cx={cx + eyeOffX + 2 * s} cy={eyeY - 1.5 * s} rx={1.8 * s} ry={1.8 * s} fill="#fff" opacity={0.9} />
      {/* Nose */}
      <Ellipse cx={cx} cy={noseY} rx={5 * s} ry={3.5 * s} fill="#E07AA0" />
      {/* Mouth */}
      <Path
        d={`M ${cx - 10 * s} ${mouthY} Q ${cx} ${mouthY + 8 * s} ${cx + 10 * s} ${mouthY}`}
        stroke="#C45E82"
        strokeWidth={2 * s}
        fill="none"
        strokeLinecap="round"
      />
      {/* Stuffed: sweat drop */}
      {mood === 'stuffed' && (
        <Path
          d={`M ${cx + bRx - 8 * s} ${bCY - 20 * s} Q ${cx + bRx} ${bCY - 14 * s} ${cx + bRx - 8 * s} ${bCY - 8 * s}`}
          stroke="#60A5FA"
          strokeWidth={2.5 * s}
          fill="none"
          strokeLinecap="round"
        />
      )}
      {/* Slim: sparkle */}
      {mood === 'slim' && (
        <SvgText
          x={cx + bRx - 4 * s}
          y={bCY - 14 * s}
          fontSize={14 * s}
          textAnchor="middle"
          fill="#FBBF24"
        >
          ✦
        </SvgText>
      )}
    </Svg>
  );
}

const TAP_LINES = [
  '你干嘛呀～', '别戳我！', '再戳我咬你哦！', '嘿嘿嘿～',
  '我在想你的照片…', '帮我再清理一点嘛！', '戳戳戳，就知道戳！',
  '我有点痒…', '饿了饿了！', '你是我最好的主人！',
];

export function PetAvatar({ fillRatio, freedBytes, speechText, size = 150 }: PetAvatarProps) {
  const mood = getMood(fillRatio);
  const [tapLine, setTapLine] = useState<string | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubble = tapLine ?? (speechText ?? pickLine(mood, freedBytes));

  const handleTap = useCallback(() => {
    const line = TAP_LINES[Math.floor(Math.random() * TAP_LINES.length)];
    setTapLine(line);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapLine(null), 2000);
  }, []);

  const floatY = useSharedValue(0);
  const bounceScale = useSharedValue(1);

  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-7, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
        withTiming(0,  { duration: 1500, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [floatY]);

  useEffect(() => {
    if (freedBytes > 0) {
      bounceScale.value = withSequence(
        withSpring(1.18, { damping: 3, stiffness: 280 }),
        withSpring(0.90, { damping: 5, stiffness: 380 }),
        withSpring(1.0,  { damping: 8, stiffness: 300 }),
      );
    }
  }, [freedBytes, bounceScale]);

  const petStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: floatY.value },
      { scale: bounceScale.value },
    ],
  }));

  return (
    <View style={styles.wrapper}>
      <View style={styles.bubbleWrapper}>
        <View style={styles.bubble}>
          <ThemedText style={styles.bubbleText}>{bubble}</ThemedText>
        </View>
        <View style={styles.bubbleTail} />
      </View>
      <Animated.View style={[petStyle, { marginTop: 4 }]}>
        <PetSVG mood={mood} size={size} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    paddingTop: 8,
  },
  bubbleWrapper: {
    alignItems: 'center',
    marginBottom: 0,
  },
  bubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: 220,
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  bubbleText: {
    fontSize: 13,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 18,
  },
  bubbleTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
    marginTop: -1,
  },
});
