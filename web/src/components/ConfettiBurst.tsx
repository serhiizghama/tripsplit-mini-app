/**
 * One-shot confetti burst for the Wrap screen (`docs/TRIP_WRAP_PLAN.md` task
 * W3) — a hand-rolled `<canvas>` overlay, no animation library. ~120 pieces
 * fall/rotate with a slight horizontal drift for a few seconds, then the
 * component calls `onDone` so the caller can drop it from the tree (the
 * fixed overlay would otherwise sit there doing nothing forever). Skips the
 * whole thing under `prefers-reduced-motion: reduce`.
 */
import { useEffect, useRef } from 'react';

const PARTICLE_COUNT = 120;
const DURATION_MS = 3000;
const COLORS = ['#ff6a5a', '#ffb020', '#17c98a', '#4c93ff', '#a06bff', '#ff5c8a'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
}

function spawnParticle(width: number): Particle {
  return {
    x: Math.random() * width,
    y: -20 - Math.random() * 300, // staggered above the viewport, not all at once
    vx: (Math.random() - 0.5) * 1.6,
    vy: 2.2 + Math.random() * 3,
    size: 6 + Math.random() * 6,
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 12,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
  };
}

export function ConfettiBurst({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Kept fresh via a ref rather than an effect dependency, so a parent
  // re-render mid-burst (e.g. a query refetch) never restarts the animation.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDoneRef.current();
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      onDoneRef.current();
      return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const particles = Array.from({ length: PARTICLE_COUNT }, () => spawnParticle(width));
    const start = performance.now();
    let frameId: number;

    function tick(now: number) {
      const elapsed = now - start;
      ctx!.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate((p.rotation * Math.PI) / 180);
        ctx!.fillStyle = p.color;
        ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx!.restore();
      }

      if (elapsed < DURATION_MS) {
        frameId = requestAnimationFrame(tick);
      } else {
        onDoneRef.current();
      }
    }
    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      // antd-mobile's Popup body sits at z-index 1010 (`--adm-popup-z-index`
      // + 10) — this has to clear that to draw over the Wrap screen's sheet.
      style={{ position: 'fixed', inset: 0, zIndex: 2000, pointerEvents: 'none' }}
    />
  );
}
