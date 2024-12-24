import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();

ffmpeg.on("log", ({ message }) => {
  console.log(`[FFmpeg]: ${message}`)
})

const base = "https://unpkg.com/@ffmpeg/core@0.12.2/dist/esm";
(async()=>{
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
  })
  document.getElementById('loading').style.display = 'none';
})()

async function fetchM3U8(url) {
  let content = await fetch(url);
  content = await content.text();
  if (content.includes('#EXT-X-STREAM-INF')) {
    console.log('Fetched playlist');
    let bm = content
      .match(/^#EXT-X-STREAM-INF:.+?$/gm)
      .map(c=>Number(c.match(/BANDWIDTH=[0-9]+?,/)[0]
      .match(/[0-9]+/)[0]))
      .sort((a,b)=>b-a)[0];
    let reg = new RegExp(`#EXT-X-STREAM-INF:.*?,BANDWIDTH=${bm},.*?`);
    let g = content.split('\n').findIndex(i=>i.match(reg));
    if (g<0) throw new Error('Playlist without biggest bandwidth video?');
    let u = content.split('\n')[g+1];
    let uu = new URL(u, url).href;
    console.log('Fetching video: '+uu)
    let newCon = await fetchM3U8(uu);
    return [uu, newCon[1]];
  } else {
    console.log('Fetched video')
    return [url, content];
  }
}
async function fetchSegments(m3u8) {
  const baseUrl = m3u8[0].substring(0, m3u8[0].lastIndexOf("/") + 1);
  const lines = m3u8[1].split("\n");
  const segments = [];

  for (const line of lines) {
    if (line && !line.startsWith("#")) {
      const segmentUrl = new URL(line, baseUrl).href;
      console.log(`Fetching segment: ${segmentUrl}`);
      segments.push({ name: line, data: await fetchFile(segmentUrl) });
    }
  }
  return segments;
}

document.getElementById('convert').onclick = async function(){
  let url = document.getElementById('url').value;
  let m3u8 = await fetchM3U8(url);
  let segments = await fetchSegments(m3u8);

  for (let { name, data } of segments) {
    await ffmpeg.writeFile(name, data);
  }

  await ffmpeg.writeFile("playlist.m3u8", m3u8[1]);
  await ffmpeg.exec([
    '-allowed_extensions', 'ALL',
    '-i', 'playlist.m3u8',
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    'output.mp4'
  ]);
  const data = await ffmpeg.readFile('output.mp4');
  const videoBlob = new Blob([data.buffer], { type: 'video/mp4' });
  document.getElementById('video').src = URL.createObjectURL(videoBlob);
}