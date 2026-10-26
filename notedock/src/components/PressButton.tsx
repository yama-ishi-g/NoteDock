import type { ButtonHTMLAttributes, KeyboardEvent, PointerEvent } from 'react'

// ツールバーのボタンは、指やペンが触れた瞬間（pointerdown）に反応させる。
// click は指を離した後に遅れて届き、切り替えが遅く感じられるため（段階0の実機検証で確認。内部仕様書 6.5.1）
// ただしファイル選択を開くボタンは、離したとき（pointerup）に反応させる（onRelease）。
// Safari は指・ペンの pointerdown をユーザー操作と見なさず、そこから <input type="file"> を開けないため
export default function PressButton({ onPress, onRelease, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { onPress?: () => void; onRelease?: () => void }) {
  return (
    <button
      type="button"
      {...rest}
      onPointerDown={(e: PointerEvent) => {
        if (e.button !== 0) return
        e.preventDefault()
        onPress?.()
      }}
      onPointerUp={(e: PointerEvent) => {
        // 指・ペンは touchend で処理する（iPad の Safari が確実にユーザー操作と見なすため）
        if (e.button !== 0 || !onRelease || e.pointerType !== 'mouse') return
        e.preventDefault()
        onRelease()
      }}
      onTouchEnd={(e) => {
        if (!onRelease) return
        e.preventDefault()
        onRelease()
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          ;(onPress ?? onRelease)?.()
        }
      }}
    />
  )
}
