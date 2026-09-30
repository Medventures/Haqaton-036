// Выбор аватара: реалистичная Аружан или робот Клэри. Общий набор свойств.
import type { AvatarId } from '../../shared/i18n';
import type { Mood } from '../../shared/types';
import type { MouthFrame } from '../voice/types';
import Avatar from './Avatar';
import RealisticAvatar from './RealisticAvatar';

export interface AvatarProps {
  avatar: AvatarId;
  mood?: Mood;
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
  size?: number;
  framing?: 'bust' | 'head';
  /** Упрощённая открытость рта 0..1 (запасной вариант). */
  mouth?: number;
  /** Источник кадров липсинка (VoiceApi.getMouthFrame). */
  mouthSource?: () => MouthFrame;
  className?: string;
  /** Бейдж «ИИ» у реалистичного аватара (по умолчанию включён). */
  showBadge?: boolean;
}

export default function AssistantAvatar({ avatar, showBadge, ...p }: AvatarProps) {
  if (avatar === 'aruzhan') return <RealisticAvatar {...p} showBadge={showBadge} />;
  return <Avatar mood={p.mood} speaking={p.speaking} listening={p.listening} thinking={p.thinking} size={p.size} framing={p.framing} mouth={p.mouth} mouthSource={p.mouthSource} className={p.className} />;
}
