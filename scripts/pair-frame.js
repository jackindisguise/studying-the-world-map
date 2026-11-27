// One documentation picture from two screenshots: the front and back of a card side by side, with a red arrow between them.

// left and right: image paths relative to the page. w and h: the size of each screenshot. isPhone: portrait pictures.
export const pairFrame = (left, right, { w, h, isPhone }) => {
  const shotW = isPhone ? w : 760;
  const shotH = Math.round((h * shotW) / w);
  const pad = isPhone ? 44 : 48;
  const top = 78; // room for the labels and the arrow
  const gap = isPhone ? 130 : 120;
  const width = pad * 2 + shotW * 2 + gap;
  const height = top + shotH + pad;
  const radius = isPhone ? 30 : 10;
  const card = (src, x, tilt) => `<img class="shot" src="${src}" style="left:${x}px; transform:rotate(${tilt}deg)">`;
  const label = (text, x, cls) => `<div class="label ${cls}" style="left:${x + shotW / 2}px">${text}</div>`;
  // The arrow arcs over the gap, from the front picture onto the back one.
  const mid = pad + shotW + gap / 2;
  const y = top + Math.round(shotH * 0.42);
  const shaft = `M ${mid - 88} ${y + 8} C ${mid - 50} ${y - 62}, ${mid + 24} ${y - 66}, ${mid + 62} ${y - 14}`;
  const head = `M ${mid + 86} ${y + 20} L ${mid + 36} ${y - 6} L ${mid + 59} ${y - 14} L ${mid + 78} ${y - 33} Z`;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
    body { position: relative; font-family: "Segoe UI", Roboto, system-ui, sans-serif;
      background: radial-gradient(120% 90% at 50% 0%, #34587a 0%, #1b2f45 55%, #111d2c 100%); }
    /* faint lines of latitude and longitude behind the cards */
    .grid { position: absolute; inset: 0; stroke: #fff; stroke-opacity: .09; fill: none; }
    .shot { position: absolute; top: ${top}px; width: ${shotW}px; height: ${shotH}px; border-radius: ${radius}px;
      box-shadow: 0 22px 44px rgba(0,0,0,.5), 0 0 0 ${isPhone ? 7 : 1}px ${isPhone ? '#0b121b' : 'rgba(255,255,255,.25)'}; }
    .label { position: absolute; top: 20px; transform: translateX(-50%); padding: 5px 20px; border-radius: 20px;
      font-size: 15px; font-weight: 700; letter-spacing: .22em; text-indent: .22em; }
    .front { background: rgba(255,255,255,.14); color: #fff; border: 1px solid rgba(255,255,255,.35); }
    .back { background: #d9371e; color: #fff; border: 1px solid #f26a52; }
    .arrow { position: absolute; inset: 0; filter: drop-shadow(0 5px 6px rgba(0,0,0,.45)); }
  </style>
  <svg class="grid" width="${width}" height="${height}" viewBox="0 0 1000 1000" preserveAspectRatio="none">
    <path d="M0 200Q500 120 1000 200M0 420Q500 360 1000 420M0 640Q500 610 1000 640M0 860Q500 860 1000 860"/>
    <path d="M500 0V1000M330 0Q250 500 330 1000M670 0Q750 500 670 1000M160 0Q0 500 160 1000M840 0Q1000 500 840 1000"/>
  </svg>
  ${label('FRONT', pad, 'front')}${label('BACK', pad + shotW + gap, 'back')}
  ${card(left, pad, -1.2)}${card(right, pad + shotW + gap, 1.2)}
  <svg class="arrow" width="${width}" height="${height}" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${shaft}" stroke="#fff" stroke-width="19"/><path d="${head}" fill="#fff" stroke="#fff" stroke-width="10"/>
    <path d="${shaft}" stroke="#e23b22" stroke-width="10"/><path d="${head}" fill="#e23b22" stroke="#e23b22" stroke-width="2"/>
  </svg>`;
  return { html, width, height };
};
