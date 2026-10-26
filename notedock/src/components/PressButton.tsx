import type { ButtonHTMLAttributes, KeyboardEvent, PointerEvent } from 'react'

// ツールバーのボタンは、指やペンが触れた瞬間（pointerdown）に反応させる。
// click は指を離した後に遅れて届き、切り替えが遅く感じられるため（段階0の実機検証で確認。内部仕様書 6.5.1）
export default function PressButton({ onPress, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { onPress: () => void }) {
  return (
    <button
      type="button"
      {...rest}
      onPointerDown={(e: PointerEvent) => {
        if (e.button !== 0) return
        e.preventDefault()
        onPress()
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPress()
        }
      }}
    />
  )
}
