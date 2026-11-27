// A mock Anki window (desktop) or phone app screen, drawn around a card for the documentation screenshots.
// The card sits in an iframe, so it lays itself out for the space inside the frame as it would in the app.

const DECK = 'Studying the World Map';
// Answer buttons on the back: [label, next review interval].
const ANSWERS = [['Again', '&lt;1m'], ['Hard', '&lt;6m'], ['Good', '&lt;10m'], ['Easy', '4d']];
const COUNTS = '<span class="new">20</span><span class="learn">3</span><span class="due">42</span>';

const BASE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow: hidden; }
  body { font: 13px/1.2 "Segoe UI", Roboto, system-ui, sans-serif; color: #202020; }
  iframe { display: block; border: 0; }
  .new { color: #1d6fd6; } .learn { color: #c0392b; } .due { color: #2e8b3d; }
`;

const desktop = (src, side, w, h) => {
  const bars = { title: 32, tools: 40, bottom: 66 };
  const button = (label) => `<div class="btn">${label}</div>`;
  const bottom = side === 'front'
    ? `<div class="answer"><div class="above counts">${COUNTS}</div>${button('Show Answer')}</div>`
    : ANSWERS.map(([label, next]) => `<div class="answer"><div class="above">${next}</div>${button(label)}</div>`).join('');
  const width = w + 2;
  const height = h + bars.title + bars.tools + bars.bottom + 2;
  const html = `<!doctype html><meta charset="utf-8"><style>${BASE}
    .window { width: ${width}px; height: ${height}px; border: 1px solid #9a9a9a; background: #f5f5f5; }
    .title { height: ${bars.title}px; display: flex; align-items: center; padding-left: 10px; background: #fff; }
    .title .star { width: 14px; height: 14px; margin-right: 8px; border-radius: 3px; background: #2f6fbd; }
    .title .controls { margin-left: auto; display: flex; height: 100%; }
    .title svg { width: 46px; height: 100%; stroke: #333; fill: none; }
    .tools { height: ${bars.tools}px; display: flex; align-items: center; justify-content: center; gap: 34px; font-weight: 600; border-bottom: 1px solid #d4d4d4; }
    .bottom { height: ${bars.bottom}px; display: flex; align-items: center; justify-content: center; gap: 12px; border-top: 1px solid #d4d4d4; position: relative; }
    .answer { text-align: center; }
    .above { height: 18px; font-size: 12px; color: #555; }
    .counts span { margin: 0 5px; font-weight: 600; }
    .btn { min-width: 90px; padding: 6px 16px; background: #fff; border: 1px solid #c6c6c6; border-radius: 6px; box-shadow: 0 1px 1px rgba(0,0,0,.08); }
    .side { position: absolute; bottom: 12px; min-width: 72px; text-align: center; }
  </style><div class="window">
    <div class="title"><span class="star"></span>User 1 - Anki<div class="controls">
      <svg viewBox="0 0 46 32"><path d="M18 16h10"/></svg>
      <svg viewBox="0 0 46 32"><path d="M18.5 11.5h9v9h-9z"/></svg>
      <svg viewBox="0 0 46 32"><path d="M18 11l10 10M28 11L18 21"/></svg>
    </div></div>
    <div class="tools"><span>Decks</span><span>Add</span><span>Browse</span><span>Stats</span><span>Sync</span></div>
    <iframe src="${src}" width="${w}" height="${h}"></iframe>
    <div class="bottom"><div class="btn side" style="left:12px">Edit</div>${bottom}<div class="btn side" style="right:12px">More &#9662;</div></div>
  </div>`;
  return { html, width, height };
};

const phone = (src, side, w, h) => {
  const bars = { status: 28, app: 52, bottom: 68 };
  const bottom = side === 'front'
    ? '<div class="btn show">Show answer</div>'
    : ANSWERS.map(([label, next]) => `<div class="btn ${label.toLowerCase()}"><small>${next}</small>${label}</div>`).join('');
  const inner = h - bars.status - bars.app - bars.bottom;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE}
    .screen { width: ${w}px; height: ${h}px; background: #fff; }
    .status { height: ${bars.status}px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; background: #1f5c99; color: #fff; font-size: 12px; font-weight: 600; }
    .status svg { width: 44px; height: 12px; fill: #fff; }
    .app { height: ${bars.app}px; display: flex; align-items: center; gap: 14px; padding: 0 14px; background: #2f6fbd; color: #fff; }
    .app svg { width: 22px; height: 22px; stroke: #fff; stroke-width: 2; fill: none; flex: none; }
    .app .deck { flex: 1; min-width: 0; font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .app .counts { padding: 4px 8px; border-radius: 10px; background: #fff; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .app .counts span + span { margin-left: 7px; }
    .bottom { height: ${bars.bottom}px; display: flex; gap: 6px; padding: 8px; background: #f2f2f2; }
    .btn { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 8px; color: #fff; font-size: 15px; font-weight: 600; }
    .btn small { font-size: 11px; font-weight: 400; margin-bottom: 2px; }
    .show { background: #2f6fbd; }
    .again { background: #c0392b; } .hard { background: #6b6b6b; } .good { background: #2e8b3d; } .easy { background: #1d6fd6; }
  </style><div class="screen">
    <div class="status"><span>9:41</span><svg viewBox="0 0 44 12"><path d="M0 12h12V0zM18 12L25 2l-7-0 0 0zM30 2h11v10H30zM42 5h2v4h-2z"/></svg></div>
    <div class="app">
      <svg viewBox="0 0 24 24"><path d="M20 12H5M11 5l-7 7 7 7"/></svg>
      <span class="deck">${DECK}</span><span class="counts">${COUNTS}</span>
      <svg viewBox="0 0 24 24"><path d="M12 5v.5M12 12v.5M12 19v.5" stroke-linecap="round" style="stroke-width:3.5"/></svg>
    </div>
    <iframe src="${src}" width="${w}" height="${inner}"></iframe>
    <div class="bottom">${bottom}</div>
  </div>`;
  return { html, width: w, height: h };
};

// src: the card page, relative to the frame page. w and h: the card area on desktop, the whole screen on a phone.
export const ankiFrame = (src, { side, isPhone, w, h }) => (isPhone ? phone : desktop)(src, side, w, h);
