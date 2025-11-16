export function createStarfieldTexture(
  THREE,
  { size = 2048, starCount = 3200, baseColor = '#010005', minRadius = 0.02, maxRadius = 0.12 } = {}
) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < starCount; i += 1) {
    const radius = minRadius + Math.random() * (maxRadius - minRadius);
    const x = Math.random() * size;
    const y = Math.random() * size;
    const hue = 180 + Math.random() * 60;
    const opacity = 0.35 + Math.random() * 0.45;
    ctx.fillStyle = `hsla(${hue}, 90%, ${75 + Math.random() * 25}%, ${opacity})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (Math.random() > 0.995) {
      const glowRadius = radius * (6 + Math.random() * 6);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
      gradient.addColorStop(0, `hsla(${hue}, 100%, 88%, ${opacity * 0.7})`);
      gradient.addColorStop(0.6, `hsla(${hue}, 95%, 75%, ${opacity * 0.25})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
