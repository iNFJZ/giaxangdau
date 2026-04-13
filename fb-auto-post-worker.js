/**
 * Cloudflare Worker: Auto-post fuel prices to Facebook Page
 * Cron triggers: 7:00 AM, 1:00 PM, 7:00 PM Vietnam time
 *
 * Environment variables needed:
 *   FB_PAGE_ID     - Facebook Page ID
 *   FB_PAGE_TOKEN  - Long-lived Page Access Token
 *   HCTI_USER_ID   - htmlcsstoimage.com User ID (free, for infographic)
 *   HCTI_API_KEY   - htmlcsstoimage.com API Key (free, for infographic)
 */

const PVOIL_URL = 'https://www.pvoil.com.vn/tin-gia-xang-dau';

async function scrapePVOIL() {
  const resp = await fetch(PVOIL_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelBot/1.0)' }
  });
  if (!resp.ok) throw new Error('PVOIL fetch failed: ' + resp.status);
  const html = await resp.text();

  let adjustDate = '';
  const dateMatch = html.match(/(\d{1,2}:\d{2})\s+ngày\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (dateMatch) adjustDate = dateMatch[2] + ' ' + dateMatch[1];

  const fuels = [];
  const rowRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>(\d+)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const name = match[2].replace(/<[^>]+>/g, '').trim();
    const priceStr = match[3].replace(/<[^>]+>/g, '').replace(/[^\d]/g, '');
    const changeStr = match[4].replace(/<[^>]+>/g, '').replace(/[^\d-]/g, '');
    const price = parseInt(priceStr, 10);
    const change = parseInt(changeStr, 10);
    if (isNaN(price)) continue;
    fuels.push({ name, price, change: isNaN(change) ? 0 : change });
  }

  return { adjustDate, fuels };
}

function formatPrice(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function getTimeSlot() {
  const hour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false });
  const h = parseInt(hour, 10);
  if (h < 10) return 'morning';
  if (h < 16) return 'noon';
  return 'evening';
}

function getDayOfWeek() {
  const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const idx = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' });
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return days[map[idx] ?? 0];
}

function getDayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

function pickRandom(arr, seed) {
  return arr[seed % arr.length];
}

function getFuelStyle(name) {
  const n = name.toLowerCase();
  if (n.includes('ron 95') || n.includes('ron95')) return { bg: 'rgba(239,68,68,0.85)', border: '#ef4444', icon: '🔴', color: '#ef4444', bgLight: 'rgba(239,68,68,0.08)' };
  if (n.includes('e5') || n.includes('ron 92') || n.includes('ron92')) return { bg: 'rgba(34,197,94,0.85)', border: '#22c55e', icon: '🟢', color: '#22c55e', bgLight: 'rgba(34,197,94,0.08)' };
  if (n.includes('do ') || n.includes('diesel')) return { bg: 'rgba(251,191,36,0.85)', border: '#fbbf24', icon: '🟡', color: '#fbbf24', bgLight: 'rgba(251,191,36,0.08)' };
  if (n.includes('hoả') || n.includes('hoa')) return { bg: 'rgba(96,165,250,0.85)', border: '#60a5fa', icon: '🔵', color: '#60a5fa', bgLight: 'rgba(96,165,250,0.08)' };
  return { bg: 'rgba(148,163,184,0.85)', border: '#94a3b8', icon: '⚪', color: '#94a3b8', bgLight: 'rgba(148,163,184,0.08)' };
}

async function generateChartUrl(data) {
  const { fuels, adjustDate } = data;
  const today = new Date().toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
  const fuelLabels = fuels.map(f => {
    if (f.change === 0) return f.name;
    const sign = f.change > 0 ? '  ▲ +' : '  ▼ ';
    return f.name + sign + formatPrice(Math.abs(f.change));
  });
  const subtitle = today + (adjustDate ? '   •   Kỳ ĐH: ' + adjustDate : '');
  const config = {
    type: 'horizontalBar',
    data: {
      labels: fuelLabels,
      datasets: [{
        data: fuels.map(f => f.price),
        backgroundColor: fuels.map(f => getFuelStyle(f.name).bg),
        borderColor: fuels.map(f => getFuelStyle(f.name).border),
        borderWidth: 2,
        barPercentage: 0.7,
        categoryPercentage: 0.85,
      }]
    },
    options: {
      title: {
        display: true,
        text: ['⛽  GIÁ XĂNG DẦU HÔM NAY', subtitle, 'giaxangdau.pages.dev'],
        fontSize: 20,
        fontColor: '#f1f5f9',
        fontStyle: 'bold',
        padding: 20,
        lineHeight: 1.6,
      },
      legend: { display: false },
      layout: { padding: { left: 15, right: 90, top: 5, bottom: 15 } },
      scales: {
        xAxes: [{
          ticks: { fontColor: '#94a3b8', fontSize: 11, beginAtZero: true, callback: 'TICK_CB' },
          gridLines: { color: 'rgba(148,163,184,0.12)', zeroLineColor: 'rgba(148,163,184,0.25)' }
        }],
        yAxes: [{
          ticks: { fontColor: '#f1f5f9', fontSize: 14, fontStyle: 'bold' },
          gridLines: { display: false }
        }]
      },
      plugins: {
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: '#ffffff',
          font: { weight: 'bold', size: 15 },
          formatter: 'LABEL_CB',
        }
      }
    }
  };
  let chartStr = JSON.stringify(config);
  chartStr = chartStr.replace('"TICK_CB"', "function(v){return v===0?'0':(v/1000).toFixed(0)+'k'}");
  chartStr = chartStr.replace('"LABEL_CB"', "function(v){return v.toLocaleString('vi-VN')+' đ'}");
  const chartHeight = Math.max(400, 100 + fuels.length * 85);
  const resp = await fetch('https://quickchart.io/chart/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      backgroundColor: '#0f172a',
      width: 800,
      height: chartHeight,
      devicePixelRatio: 2.0,
      format: 'png',
      chart: chartStr,
    })
  });
  const result = await resp.json();
  if (!result.success) throw new Error('QuickChart: ' + (result.message || 'failed'));
  return result.url;
}

function buildInfographicHtml(data, slot) {
  const { fuels, adjustDate } = data;
  const today = new Date().toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric'
  });
  const dayName = getDayOfWeek();
  const dayOfYear = getDayOfYear();
  const hasUp = fuels.some(f => f.change > 0);
  const hasDown = fuels.some(f => f.change < 0);
  let trendText = '➡️ Giữ nguyên';
  if (hasUp && hasDown) trendText = '↕️ Tăng giảm đan xen';
  else if (hasUp) trendText = '📈 Xu hướng TĂNG';
  else if (hasDown) trendText = '📉 Xu hướng GIẢM';
  const tipPool = [
    'Đổ xăng sáng sớm khi trời mát — nhiên liệu đậm đặc hơn!',
    'Lái đều ga, tránh tăng tốc đột ngột — tiết kiệm 20% xăng!',
    'Kiểm tra lốp thường xuyên: lốp non hao 3-5% xăng mỗi tháng!',
    'Chạy 60-80 km/h là tốc độ tiết kiệm xăng nhất.',
    'Tắt máy khi dừng đỗ quá 30 giây — tiết kiệm 5-10%!',
    'Bảo dưỡng xe định kỳ tiết kiệm đến 15% nhiên liệu.',
    'Sử dụng chế độ ECO nếu xe có — tiết kiệm 5-15%!',
    'Đỗ xe dưới bóng mát giúp giảm bay hơi xăng.',
  ];
  const tip = pickRandom(tipPool, dayOfYear);
  const gradients = {
    morning: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
    noon: 'linear-gradient(135deg, #ef4444 0%, #ec4899 100%)',
    evening: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  };
  const timeSlot = slot || getTimeSlot();
  const gradient = gradients[timeSlot] || gradients.morning;
  let fuelsHtml = '';
  for (const f of fuels) {
    const s = getFuelStyle(f.name);
    const chgColor = f.change > 0 ? '#ef4444' : f.change < 0 ? '#22c55e' : '#94a3b8';
    const arrow = f.change > 0 ? '▲' : f.change < 0 ? '▼' : '—';
    const chgText = f.change !== 0
      ? `${arrow} ${f.change > 0 ? '+' : '-'}${formatPrice(Math.abs(f.change))} đ`
      : '— Không đổi';
    fuelsHtml += `<div style="display:flex;align-items:center;background:${s.bgLight};border-left:4px solid ${s.color};border-radius:10px;padding:14px 16px;margin-bottom:10px;">` +
      `<div style="flex:1;">` +
      `<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">${s.icon} Nhiên liệu</div>` +
      `<div style="font-size:17px;font-weight:800;color:#f1f5f9;margin-top:3px;">${f.name}</div>` +
      `</div>` +
      `<div style="text-align:right;">` +
      `<div style="font-size:26px;font-weight:900;color:${s.color};">${formatPrice(f.price)} <span style="font-size:13px;font-weight:500;opacity:0.7;">đ/L</span></div>` +
      `<div style="font-size:12px;color:${chgColor};font-weight:600;margin-top:2px;">${chgText}</div>` +
      `</div></div>`;
  }
  return `<div style="width:600px;font-family:'Inter',sans-serif;background:linear-gradient(160deg,#0f172a 0%,#1e293b 40%,#0f172a 100%);color:#f1f5f9;overflow:hidden;">` +
    `<div style="background:${gradient};padding:24px 28px;text-align:center;">` +
    `<div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;opacity:0.9;">⛽ Cập nhật giá xăng dầu</div>` +
    `<div style="font-size:34px;font-weight:900;margin:6px 0;text-shadow:0 2px 10px rgba(0,0,0,0.2);">HÔM NAY</div>` +
    `<div style="font-size:15px;opacity:0.95;">📅 ${dayName}, ${today}</div>` +
    `</div>` +
    `<div style="display:flex;justify-content:center;gap:20px;padding:12px 20px;background:rgba(255,255,255,0.03);flex-wrap:wrap;">` +
    `<span style="font-size:12px;color:#94a3b8;">🗓️ Kỳ ĐH: ${adjustDate || 'Mới nhất'}</span>` +
    `<span style="font-size:12px;color:#94a3b8;">${trendText}</span>` +
    `</div>` +
    `<div style="padding:18px 22px;">${fuelsHtml}</div>` +
    `<div style="margin:0 22px 18px;padding:14px 16px;background:rgba(96,165,250,0.08);border-left:3px solid #60a5fa;border-radius:0 10px 10px 0;">` +
    `<div style="font-size:13px;color:#cbd5e1;line-height:1.5;">💡 ${tip}</div>` +
    `</div>` +
    `<div style="background:rgba(255,255,255,0.04);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;">` +
    `<div><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Chi tiết & biểu đồ</div>` +
    `<div style="font-size:16px;font-weight:800;color:#60a5fa;">giaxangdau.pages.dev</div></div>` +
    `<div style="font-size:11px;color:#475569;text-align:right;">❤️ Like & Share<br>giúp mọi người cập nhật</div>` +
    `</div></div>`;
}

async function generateInfographicUrl(html, env) {
  const resp = await fetch('https://hcti.io/v1/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(env.HCTI_USER_ID + ':' + env.HCTI_API_KEY),
    },
    body: JSON.stringify({
      html: html,
      css: 'body { margin: 0; }',
      google_fonts: 'Inter',
    })
  });
  const result = await resp.json();
  if (!result.url) throw new Error('HCTI: ' + JSON.stringify(result));
  return result.url;
}

async function generateImageUrl(data, slot, env) {
  const timeSlot = slot || getTimeSlot();
  if (timeSlot === 'morning' && env.HCTI_USER_ID && env.HCTI_API_KEY) {
    try {
      const html = buildInfographicHtml(data, timeSlot);
      return { url: await generateInfographicUrl(html, env), mode: 'infographic' };
    } catch (err) {
      console.error('Infographic failed, falling back to chart:', err.message);
    }
  }
  try {
    return { url: await generateChartUrl(data), mode: 'chart' };
  } catch (err) {
    console.error('Chart failed:', err.message);
    return { url: null, mode: 'text' };
  }
}

async function buildFacebookPost(data, slot, env) {
  const { adjustDate, fuels } = data;
  const now = new Date();
  const today = now.toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
  const time = now.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit', minute: '2-digit'
  });
  const dayName = getDayOfWeek();
  const dayOfYear = getDayOfYear();
  const timeSlot = slot || getTimeSlot();

  const morningGreetings = [
    `🌅 Chào buổi sáng ${dayName}!`,
    `☀️ ${dayName} tràn đầy năng lượng!`,
    `🌄 Khởi đầu ngày mới ${dayName} vui vẻ!`,
    `🌞 Chúc bạn ${dayName} thật hiệu quả!`,
    `☕ Sáng ${dayName} — cà phê xong cập nhật giá xăng!`,
  ];
  const noonGreetings = [
    `🔔 Cập nhật giữa ngày ${dayName}!`,
    `📢 Bản tin trưa ${dayName} — Giá xăng dầu!`,
    `☀️ ${dayName} buổi trưa — Giá nhiên liệu mới nhất!`,
    `📋 Nắm giá xăng trước khi ra đường chiều nay!`,
    `🕐 Trưa ${dayName} — Kiểm tra giá xăng ngay!`,
  ];
  const eveningGreetings = [
    `🌙 Tổng kết giá xăng ${dayName} buổi tối!`,
    `🌆 Cuối ngày ${dayName} — Cập nhật giá xăng dầu!`,
    `🏠 Về nhà an toàn — Giá xăng hôm nay!`,
    `✨ Tối ${dayName} — Cập nhật cuối ngày!`,
    `🌃 ${dayName} kết thúc — Cùng xem giá xăng!`,
  ];

  const greetingPool = {
    morning: morningGreetings,
    noon: noonGreetings,
    evening: eveningGreetings
  };

  const tipsMorning = [
    '💡 Đổ xăng sáng sớm khi trời mát — nhiên liệu đậm đặc hơn, bạn nhận được nhiều hơn!',
    '💡 Lái đều ga, tránh tăng tốc đột ngột — tiết kiệm đến 20% xăng!',
    '💡 Bạn biết không? Xe tải nặng tiêu thụ nhiên liệu tăng 1% cho mỗi 50kg hàng thừa.',
    '💡 Kiểm tra lốp mỗi sáng: lốp non hao 3-5% xăng mỗi tháng!',
    '💡 Nên đổ xăng khi còn 1/4 bình — tránh cặn bẩn bị hút vào động cơ.',
  ];
  const tipsNoon = [
    '💡 Hạn chế bật điều hoà ở tốc độ thấp — mở cửa sổ tiết kiệm hơn!',
    '💡 Chạy 60-80 km/h là tốc độ tiết kiệm xăng nhất cho đa số xe.',
    '💡 Đỗ xe dưới bóng mát giúp giảm bay hơi xăng và mát xe nhanh hơn.',
    '💡 Sử dụng chế độ ECO nếu xe có — tiết kiệm 5-15% nhiên liệu!',
    '💡 Lên kế hoạch lộ trình trước để tránh đi vòng, tiết kiệm xăng và thời gian.',
  ];
  const tipsEvening = [
    '💡 Tắt máy khi dừng đỗ quá 30 giây — tiết kiệm 5-10% xăng!',
    '💡 Bảo dưỡng xe định kỳ giúp tiết kiệm đến 15% chi phí nhiên liệu.',
    '💡 Đổ xăng ở cây xăng uy tín, tránh xăng pha — bảo vệ động cơ lâu dài!',
    '💡 Giảm tải đồ không cần thiết trong cốp xe — nhẹ hơn = ít xăng hơn!',
    '💡 Sáng mai đi làm? Kiểm tra giá xăng trên giaxangdau.pages.dev trước khi đổ!',
  ];

  const tipsPool = { morning: tipsMorning, noon: tipsNoon, evening: tipsEvening };

  const greeting = pickRandom(greetingPool[timeSlot], dayOfYear);
  const tip = pickRandom(tipsPool[timeSlot], dayOfYear);

  const hasIncrease = fuels.some(f => f.change > 0);
  const hasDecrease = fuels.some(f => f.change < 0);
  let trendIcon = '➡️ Giữ nguyên';
  if (hasIncrease && hasDecrease) trendIcon = '↕️ Tăng giảm đan xen';
  else if (hasIncrease) trendIcon = '📈 Xu hướng TĂNG';
  else if (hasDecrease) trendIcon = '📉 Xu hướng GIẢM';

  let caption = '';
  caption += `${greeting}\n`;
  caption += `⛽ 𝗚𝗜𝗔́ 𝗫𝗔̆𝗡𝗚 𝗗𝗔̂̀𝗨 𝗛𝗢̂𝗠 𝗡𝗔𝗬\n`;
  caption += `📅 ${dayName}, ${today} — ${time}\n`;
  caption += `🗓️ Kỳ điều hành: ${adjustDate || 'Mới nhất'}\n`;
  caption += `${trendIcon}\n`;
  caption += `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n`;

  for (const fuel of fuels) {
    const { icon } = getFuelStyle(fuel.name);
    const arrow = fuel.change < 0 ? '🔻' : fuel.change > 0 ? '🔺' : '▪️';
    const changeText = fuel.change !== 0
      ? ` (${fuel.change < 0 ? '' : '+'}${formatPrice(fuel.change)})`
      : '';
    caption += `${icon} ${fuel.name}: ${formatPrice(fuel.price)} đ/L ${arrow}${changeText}\n`;
  }

  caption += `\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n`;
  caption += `${tip}\n\n`;
  caption += `📊 Chi tiết & biểu đồ: https://giaxangdau.pages.dev\n\n`;
  caption += `❤️ Like + Share giúp mọi người cùng cập nhật!\n`;
  caption += `💬 Giá xăng khu vực bạn bao nhiêu?\n\n`;
  caption += `#giaxangdau #giaxanghomnay #xangdau #RON95 #E5RON92 #diesel #giaxang #giaxangmoinhat #giaxangdauvietnam #titkiemnhienlieu`;

  const image = await generateImageUrl(data, slot, env || {});

  return { caption, chartUrl: image.url, imageMode: image.mode };
}

async function postToFacebook({ caption, chartUrl, pageId, pageToken }) {
  if (chartUrl) {
    const url = `https://graph.facebook.com/v22.0/${pageId}/photos`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: chartUrl,
        caption: caption,
        access_token: pageToken,
      })
    });
    const result = await resp.json();
    if (result.error) throw new Error(result.error.message);
    return { ...result, type: 'photo' };
  }
  const url = `https://graph.facebook.com/v22.0/${pageId}/feed`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: caption,
      access_token: pageToken,
    })
  });
  const result = await resp.json();
  if (result.error) throw new Error(result.error.message);
  return { ...result, type: 'text' };
}

export default {
  async scheduled(event, env, ctx) {
    try {
      const data = await scrapePVOIL();
      if (data.fuels.length === 0) {
        console.log('No fuel data found, skipping post');
        return;
      }
      const { caption, chartUrl, imageMode } = await buildFacebookPost(data, null, env);
      const result = await postToFacebook({
        caption, chartUrl, pageId: env.FB_PAGE_ID, pageToken: env.FB_PAGE_TOKEN
      });
      console.log(`Posted successfully (${result.type}/${imageMode}):`, result.id || result.post_id);
    } catch (err) {
      console.error('Auto-post failed:', err.message);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const slot = url.searchParams.get('slot') || null;

    if (url.pathname === '/test') {
      try {
        const data = await scrapePVOIL();
        const morning = await buildFacebookPost(data, 'morning', env);
        const noon = await buildFacebookPost(data, 'noon', env);
        const evening = await buildFacebookPost(data, 'evening', env);
        let preview = `=== BUỔI SÁNG (${morning.imageMode}) ===\n`;
        preview += morning.chartUrl ? '🖼️ Ảnh: ' + morning.chartUrl + '\n\n' : '(Không tạo được ảnh)\n\n';
        preview += morning.caption;
        preview += `\n\n\n=== BUỔI TRƯA (${noon.imageMode}) ===\n`;
        preview += noon.chartUrl ? '🖼️ Ảnh: ' + noon.chartUrl + '\n\n' : '(Không tạo được ảnh)\n\n';
        preview += noon.caption;
        preview += `\n\n\n=== BUỔI TỐI (${evening.imageMode}) ===\n`;
        preview += evening.chartUrl ? '🖼️ Ảnh: ' + evening.chartUrl + '\n\n' : '(Không tạo được ảnh)\n\n';
        preview += evening.caption;
        return new Response(preview, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    if (url.pathname === '/post-now') {
      try {
        const data = await scrapePVOIL();
        const { caption, chartUrl, imageMode } = await buildFacebookPost(data, slot, env);
        const result = await postToFacebook({
          caption, chartUrl, pageId: env.FB_PAGE_ID, pageToken: env.FB_PAGE_TOKEN
        });
        const postId = result.id || result.post_id;
        const mode = result.type === 'photo' ? `ảnh ${imageMode}` : 'text';
        return new Response(
          `Đăng bài thành công (${mode})!\nPost ID: ${postId}\n\n` +
          (chartUrl ? `Ảnh: ${chartUrl}\n\n` : '') +
          'Kiểm tra tại Facebook Page của bạn.'
        );
      } catch (err) {
        return new Response('Lỗi: ' + err.message, { status: 500 });
      }
    }

    if (url.pathname === '/preview-chart') {
      try {
        const data = await scrapePVOIL();
        const chartUrl = await generateChartUrl(data);
        return Response.redirect(chartUrl, 302);
      } catch (err) {
        return new Response('Lỗi tạo ảnh: ' + err.message, { status: 500 });
      }
    }

    if (url.pathname === '/preview-infographic') {
      try {
        const data = await scrapePVOIL();
        if (!env.HCTI_USER_ID || !env.HCTI_API_KEY) {
          const html = buildInfographicHtml(data, slot || 'morning');
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        const html = buildInfographicHtml(data, slot || 'morning');
        const imgUrl = await generateInfographicUrl(html, env);
        return Response.redirect(imgUrl, 302);
      } catch (err) {
        return new Response('Lỗi tạo infographic: ' + err.message, { status: 500 });
      }
    }

    const hasHcti = env.HCTI_USER_ID ? 'Có' : 'Chưa cấu hình';
    return new Response(
      'Fuel Price Auto-Poster\n\n' +
      '/test                = Xem trước 3 bài (sáng=infographic, trưa/tối=chart)\n' +
      '/post-now            = Đăng ngay lên Facebook\n' +
      '/preview-chart       = Xem trước ảnh biểu đồ\n' +
      '/preview-infographic = Xem trước ảnh infographic\n\n' +
      'HCTI (infographic): ' + hasHcti + '\n',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
};
