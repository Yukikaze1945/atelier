// AGPL-3.0 workstation adaptation: retain MAW's original multiline waveform editor.
let workstationPlayer=null,workstationTimeline=null,firstWaveform=true;
const actions=document.querySelector('.row-actions'),stateLabel=document.createElement('span');stateLabel.id='workstation-state';
const save=document.createElement('button');save.textContent='保存字幕';save.onclick=publishWorkstation;
const importButton=document.createElement('button');importButton.textContent='导入字幕';
const input=document.createElement('input');input.type='file';input.accept='.srt,.mosp,.json';input.hidden=true;
importButton.onclick=()=>input.click();
input.onchange=async()=>{try{const file=input.files[0];if(!file)return;const text=window.AsrEditorUtils.decodeSubtitleText(await file.arrayBuffer());if(/\.srt$/i.test(file.name))replaceMainTrack(parseSrtSegments(text),file.name);else{const data=JSON.parse(text);if(!Array.isArray(data.segments))throw Error('缺少字幕数据');const waveform=DATA.waveform;applyCanonicalProject(data,file.name);if(waveform){DATA.waveform=waveform;waveformEditor?.setPayload(waveform);}}closeProjectMediaModal();}catch(e){flashHint(e.message,'warning');}finally{input.value='';}};
const retry=document.createElement('button');retry.textContent='重新生成波形';retry.onclick=()=>parent.postMessage({type:'maw.retryWaveform'},'*');
actions.prepend(importButton,save,input,stateLabel);
document.getElementById('waveform-status').after(retry);
waveformEditor?.setMode('multi');
function publishWorkstation(){commitCuePanelEdit();const project={schema:'moy.asr.project.v1',segments:DATA.segments,media:DATA.media,language:DATA.language,model:DATA.model,timebase:DATA.timebase,preview:DATA.preview,multi_subtitle:DATA.multi_subtitle};parent.postMessage({type:'maw.document',project},'*');}
window.addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;
 try{
 if(m.type==='maw.project'){applyCanonicalProject(m.project,'项目字幕.mosp');closeProjectMediaModal();}
 if(m.type==='maw.timeline'){
  workstationTimeline=m.timeline;
  if(!workstationPlayer)workstationPlayer=new window.WorkstationTimelinePlayer(player,message=>{stateLabel.textContent=message;flashHint(message,'warning');});
  if(m.timeline){workstationPlayer.setTimeline(m.timeline,m.assets);DATA.media=m.timeline.name;document.getElementById('media-name').textContent=m.timeline.name;stateLabel.textContent='';waveformEditor?.attachPlayer(player);syncPlayerPlaceholder();document.getElementById('gap-skip-playback').checked=false;}
  else{workstationPlayer.setTimeline({clips:[],tracks:[],timebase:240000,width:1920,height:1080},[]);DATA.waveform=null;waveformEditor?.setPayload(null);stateLabel.textContent='请在信息连接中接入剪辑时间线';}
 }
 if(m.type==='maw.waveformPending'){DATA.waveform=null;waveformEditor?.setPayload(null);waveformEditor?.setStatus('正在分析工程音频…','busy');const empty=document.getElementById('waveform-empty');empty.textContent='正在从工程音频生成真实波形，首次分析需要一些时间';empty.classList.remove('hidden');}
 if(m.type==='maw.waveform'){DATA.waveform=m.payload;waveformLoadedFromProject=true;if(!waveformEditor?.setPayload(m.payload))throw Error('生成的波形数据格式无效');if(firstWaveform){waveformEditor.setMode('multi');firstWaveform=false;}waveformEditor.setMediaAvailable(true);stateLabel.textContent=m.payload.source.audio_sources?'':'当前时间线没有启用的有声音轨';renderAll({waveform:'full'});}
 if(m.type==='maw.waveformError'){waveformEditor?.setStatus('波形生成失败','error');document.getElementById('waveform-empty').textContent=m.message;stateLabel.textContent='波形生成失败，可点击重新生成';}
 if(m.type==='maw.status')stateLabel.textContent=m.message;
 if(m.type==='maw.error'){stateLabel.textContent=m.message;flashHint(m.message,'warning');}
 }catch(error){stateLabel.textContent=error.message;flashHint(error.message,'warning');}
});
window.addEventListener('beforeunload',()=>workstationPlayer?.destroy());
parent.postMessage({type:'maw.ready'},'*');
