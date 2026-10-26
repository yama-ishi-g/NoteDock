import { Maximize2, Minus, Plus } from 'lucide-react'
import PressButton from '../components/PressButton'

export default function ZoomControls({ zoom, onZoom, onFit, min, max }: { zoom: number; onZoom: (z: number) => void; onFit: () => void; min: number; max: number }) {
  const step = (dir: 1 | -1) => {
    const z = Math.min(max, Math.max(min, Math.round((zoom * (dir > 0 ? 1.25 : 0.8)) * 100) / 100))
    onZoom(z)
  }
  return (
    <div className="zoom-controls">
      <PressButton className="tool-btn" aria-label="縮小" onPress={() => step(-1)}><Minus size={18} /></PressButton>
      <span className="zoom-value">{Math.round(zoom * 100)}%</span>
      <PressButton className="tool-btn" aria-label="拡大" onPress={() => step(1)}><Plus size={18} /></PressButton>
      <PressButton className="tool-btn" aria-label="幅に合わせる" title="幅に合わせる" onPress={onFit}><Maximize2 size={18} /></PressButton>
    </div>
  )
}
