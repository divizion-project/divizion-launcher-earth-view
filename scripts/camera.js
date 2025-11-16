const CAMERA_REGEX =
  /^x(-?\d+(?:\.\d+)?)y(-?\d+(?:\.\d+)?)z(-?\d+(?:\.\d+)?)def(-?\d+(?:\.\d+)?)(?:-zoom(-?\d+(?:\.\d+)?))?$/i;

export function extractDescriptorFromPath(pathname, siteBase) {
  const segments = pathname.split('/').filter(Boolean);
  const base = siteBase?.trim();
  if (base && segments[0] === base) {
    segments.shift();
  }
  if (!segments.length) {
    return '';
  }
  if (segments[0] === 'earth-view') {
    return '';
  }
  return segments.join('');
}

function clampFov(value) {
  if (!Number.isFinite(value)) {
    return 45;
  }
  return Math.min(90, Math.max(15, value));
}

function sanitizeNumber(value, decimals = 4) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const rounded = value.toFixed(decimals);
  return rounded.replace(/\.?0+$/, '');
}

export function parseCameraDescriptor(descriptor) {
  if (!descriptor) {
    return null;
  }
  const normalized = descriptor.replace(/\s+/g, '');
  const match = normalized.match(CAMERA_REGEX);
  if (!match) {
    return null;
  }
  return {
    position: {
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      z: parseFloat(match[3])
    },
    rollDeg: parseFloat(match[4]) || 0,
    fov: match[5] ? clampFov(parseFloat(match[5])) : 45
  };
}

export function buildCameraDescriptor({ position, rollDeg, fov }) {
  const pos = position ?? { x: 0, y: 0, z: 0 };
  const roll = Number.isFinite(rollDeg) ? rollDeg : 0;
  const fieldOfView = clampFov(fov ?? 45);
  return `x${sanitizeNumber(pos.x)}y${sanitizeNumber(pos.y)}z${sanitizeNumber(pos.z)}def${sanitizeNumber(
    roll,
    2
  )}-zoom${sanitizeNumber(fieldOfView, 2)}`;
}
