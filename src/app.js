import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Load ffmpeg
const ffmpeg = new FFmpeg();

ffmpeg.on('log', ({ type, message }) => {
  console.log(`[FFmpeg]: ${type}: ${message}`);
});

const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const proxyUrl = 'https://api.fsh.plus/file?url=';
(async()=>{
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
  })
  document.getElementById('loading').style.display = 'none';
})();

// Workings
function setStatus(txt, extra) {
  console.log(txt, extra??'');
  document.getElementById('status').innerText = txt;
}

async function fetchM3U8(url) {
  let proxy = document.getElementById('proxy').checked;
  let content = await fetch(proxy?proxyUrl+encodeURIComponent(url):url);
  content = await content.text();
  if (content.includes('#EXT-X-STREAM-INF')) {
    setStatus('Playlist fetched, fetching highest quality video ...');
    // Audio
    let audioPlaylist = null;
    if ((/#EXT-X-MEDIA:.*?TYPE=AUDIO/).test(content)) {
      // Get first one, highest bitrate requires fetching all
      let audioUrl = content
        .match(/^#EXT-X-MEDIA:.*?TYPE=AUDIO.*?$/gm);/*
        .map(c=>Number(c.match(/(?:AVERAGE-BANDWIDTH|BANDWIDTH)=([0-9])+?,?/)[1]))
        .sort((a,b)=>b-a)[0];*/
      audioUrl = audioUrl[0].match(/URI="(.*?)"/)[1];
      audioUrl = new URL(audioUrl, url).href;
      audioPlaylist = await fetchM3U8(audioUrl);
      setStatus('Audio fetched', audioUrl);
    }
    // Video
    let sources = content
      .match(/^#EXT-X-STREAM-INF:.+?$/gmi)
      .map(c=>{
        console.log(c)
        let resp = (c.match(/RESOLUTION=([0-9]+x[0-9]+),?/i)[1]??'1x1').split('x');
        return {
          rawres: resp.join('x'),
          res: resp[0]*resp[1],
          band: Number(c.match(/(?:AVERAGE-BANDWIDTH|BANDWIDTH)=([0-9]+),?/i)[1])
        };
      })
      .sort((a,b)=>{
        if (a.res===b.res) return b.band-a.band;
        return b.res-a.res;
      });
    setStatus('Sources found', sources);
    let reg = new RegExp(`#EXT-X-STREAM-INF:.*?,?((?:AVERAGE-BANDWIDTH|BANDWIDTH)=${sources[0].band}|RESOLUTION=${sources[0].rawres}),?.*?`, 'i');
    let video = content.split('\n').findIndex(i=>i.match(reg));
    if (video<0) throw new Error('Could not find source?', reg);
    video = content.split('\n')[video+1];
    video = new URL(video, url).href;
    let videoPlaylist = await fetchM3U8(video);
    setStatus('Video playlist fetched', video);
    return {
      url: video,
      content: videoPlaylist.content,
      additional: audioPlaylist
    };
  } else {
    setStatus('Media fetched');
    return {
      url,
      content: content,
      additional: null
    };
  }
}
async function fetchSegments(m3u8) {
  setStatus('Fetching segments...');
  // Meta
  const baseUrl = m3u8.url.substring(0, m3u8.url.lastIndexOf('/')+1);
  const lines = m3u8.content.split('\n');
  const segments = [];

  let proxy = document.getElementById('proxy').checked;

  // Init
  if (m3u8.content.includes('#EXT-X-MAP:URI=')) {
    let init = m3u8.content.split('#EXT-X-MAP:URI="')[1].split('"')[0];
    let initUrl = new URL(init, baseUrl).href;
    setStatus(`Fetching init`, initUrl);
    if (proxy) initUrl = proxyUrl+encodeURIComponent(initUrl);
    segments.push({ name: init, data: await fetchFile(initUrl) });
  }

  // Fetching segments
  for (let i = 0; i<lines.length; i++) {
    let line = lines[i];
    if (line && !line.startsWith("#")) {
      let segmentUrl = new URL(line, baseUrl).href;
      setStatus(`Fetching segment ${i}...`, segmentUrl);
      if (proxy) segmentUrl = proxyUrl+encodeURIComponent(segmentUrl);
      segments.push({ name: line, data: await fetchFile(segmentUrl) });
    }
  }
  return segments;
}

async function ensureDirs(path) {
  let parts = path.slice(1).split('/').filter(p=>p.length).slice(0,-1);
  let current = '';

  for (const part of parts) {
    current += '/' + part;
    try {
      await ffmpeg.listDir(current);
    } catch (_) {
      await ffmpeg.createDir(current);
    }
  }
}


document.getElementById('convert').onclick = async function(){
  // Fetches
  let url = document.getElementById('url').value;
  setStatus('Fetching...');
  let m3u8 = await fetchM3U8(url);
  let segments = await fetchSegments(m3u8);
  let audioSegments = [];
  if (m3u8.additional) audioSegments = await fetchSegments(m3u8.additional);

  // Writing
  for (let { name, data } of segments.concat(audioSegments)) {
    setStatus('Writing '+name);
    try {
      await ensureDirs(name);
      await ffmpeg.writeFile(name, data);
    } catch(err) {
      setStatus('Could not write '+name, err);
      return;
    }
  }

  setStatus('Writing playlist...');
  await ffmpeg.writeFile('/video.m3u8', m3u8.content);
  if (m3u8.additional) {
    await ffmpeg.writeFile('/audio.m3u8', m3u8.additional.content);
  }

  // Convert
  setStatus('Converting...');
  let exec = [
    '-allowed_extensions', 'ALL',
    '-i', '/video.m3u8'
  ];
  if (m3u8.additional) {
    exec = exec.concat([
      '-i', '/audio.m3u8',
      '-c:v', 'copy',
      '-c:a', 'aac'
    ]);
  } else {
    exec = exec.concat([
      '-c', 'copy'
    ]);
  }
  exec = exec.concat([
    '-bsf:a', 'aac_adtstoasc',
    'output.mp4'
  ]);
  await ffmpeg.exec(exec);
  const data = await ffmpeg.readFile('output.mp4');
  const videoBlob = new Blob([data.buffer], { type: 'video/mp4' });
  setStatus('Done!');
  document.getElementById('video').src = URL.createObjectURL(videoBlob);
}