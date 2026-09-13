import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','plugins','moy-subtitles');
const read=name=>readFile(path.join(root,'upstream','web',name),'utf8');
const scripts=(await read('editor-scripts.txt')).split(/\r?\n/).map(l=>l.split('#')[0].trim()).filter(name=>name&&name!=='editor-onboarding.js');
let page=await read('editor-template.html');
const replacements={
 '__EDITOR_CSS__':await read('editor.css'),'__WAVEFORM_CSS__':await read('waveform.css'),'__EDITOR_SCRIPTS_JS__':(await Promise.all(scripts.map(read))).join('\n\n'),
 '__TITLE__':'Moy 字幕编辑器','__MEDIA_HTML__':'<video id="player" preload="metadata" style="width:100%;background:#000;display:block"></video>',
 '__DATA_JSON__':JSON.stringify({segments:[],media:'',language:'',model:''}),'__FILENAME_BASE_JSON__':'"workstation"','__STICKERS_JSON__':'[]','__STICKER_ROOT_JSON__':'""','__STICKER_URL_PREFIX_JSON__':'""','__SERVER_CONFIG_JSON__':'null','__EDITOR_LOADING_HIDDEN__':' hidden','__NINJA_SFX_BASE_URL_JSON__':'"upstream/web/sfx/"','__UI_LANGUAGE_JSON__':'"zh"','__APP_VERSION__':'MAW · 工作站适配','__JSON_DISPLAY__':'工作站字幕','__JSON_NAME_CLASS__':'empty','__MEDIA_NAME_DISPLAY__':'选择项目素材','__MEDIA_NAME_TITLE__':'','__MEDIA_NAME_CLASS__':'empty',
 '__PALETTE_JSON__':JSON.stringify([['yellow','#c4a019'],['green','#66bb6a'],['red','#f07f6f'],['purple','#bf89e6'],['blue','#61a7fa']].map(([name,value])=>({name,value})))
};
// Match upstream render_editor_page ordering: scripts first, then their data tokens.
for(const [token,value] of Object.entries(replacements))page=page.replaceAll(token,()=>value);
const unresolved=page.match(/__(?:DATA_JSON|FILENAME_BASE_JSON|TITLE|MEDIA_HTML|EDITOR_CSS|WAVEFORM_CSS|EDITOR_SCRIPTS_JS)__/g);
if(unresolved)throw Error('Unresolved editor tokens: '+unresolved.join(','));
const end=page.lastIndexOf('</body>');
if(end<0)throw Error('Missing editor body');
page=page.replace('</head>','<link rel="stylesheet" href="workstation-theme.css"></head>');
const bodyEnd=page.lastIndexOf('</body>');
page=page.slice(0,bodyEnd)+'<script src="timeline-player.js"></script><script src="maw-host-bridge.js"></script>'+page.slice(bodyEnd);
let scriptNumber=0;
for(const match of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new Script(match[1],{filename:`maw-inline-${++scriptNumber}.js`});
await writeFile(path.join(root,'editor.html'),page,'utf8');
console.log('Built MAW editor from vendored web sources.');
