/* AGPL-3.0 workstation adapter: automatically resolves the connected project timeline. */
let context,ready=false,restored=false,lastKey='',generation=0,waveTimer;
const pending=new Map(),frame=document.getElementById('maw');
function request(method,params={}){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending.set(id,{resolve,reject});parent.postMessage({type:'workstation.request',id,method,params},'*');});}
function inner(message){if(ready)frame.contentWindow.postMessage(message,'*');}
async function sync(){if(!context||!ready)return;
 const node=context.project.workspace.pages.find(n=>n.id===context.nodeId),doc=node?.privateState?.outputs?.subtitles;
 if(!restored){restored=true;const offset=(doc?.offsetSeconds||0)*1000;const state=doc?.mawProject?{...doc.mawProject,segments:doc.mawProject.segments.map(s=>({...s,start:s.start+offset,end:s.end+offset,items:s.items?.map(i=>({...i,start:i.start+offset,end:i.end+offset}))}))}:{schema:'moy.asr.project.v1',segments:(doc?.cues||[]).map(c=>({start:Math.round(c.startTicks/doc.timebase*1000),end:Math.round(c.endTicks/doc.timebase*1000),text:c.text})),media:'',language:'',model:''};inner({type:'maw.project',project:state});}
 const binding=context.information?.bindings?.find(b=>b.inputPort==='timeline'&&b.status==='available');
 const timeline=binding?context.project.timeline:null;
 const key=JSON.stringify([timeline,context.project.assets.map(a=>[a.id,a.revision,a.sourceUri,a.projectPath])]);if(key===lastKey)return;lastKey=key;
 const run=++generation;
 clearTimeout(waveTimer);
 if(!timeline){inner({type:'maw.timeline',timeline:null,assets:[]});return;}
 try{const ids=new Set(timeline.clips.map(c=>c.assetId));const assets=await Promise.all(context.project.assets.filter(a=>ids.has(a.id)).map(async a=>({...a,url:await request('asset.previewUrl',{projectId:context.project.id,assetId:a.id})})));if(run!==generation)return;inner({type:'maw.timeline',timeline,assets});if(timeline.clips.length){inner({type:'maw.waveformPending'});waveTimer=setTimeout(async()=>{try{const payload=await request('media.waveform',{projectId:context.project.id});if(run===generation)inner({type:'maw.waveform',payload});}catch(e){if(run===generation)inner({type:'maw.waveformError',message:e.message});}},600);}}
 catch(e){if(run===generation){lastKey='';inner({type:'maw.error',message:e.message});}}
}
window.addEventListener('message',async e=>{const m=e.data;
 if(e.source===frame.contentWindow){if(m.type==='maw.ready'){ready=true;void sync();}
 if(m.type==='maw.retryWaveform'){lastKey='';void sync();}
 if(m.type==='maw.document'){try{const cues=m.project.segments.map(s=>({id:crypto.randomUUID(),startTicks:Math.round(s.start),endTicks:Math.round(s.end),text:String(s.text||'')}));
 const project=await request('project.command',{projectId:context.project.id,expectedRevision:context.project.revision,command:{type:'information.publish',nodeId:context.nodeId,portId:'subtitles',value:{schema:'workstation.subtitles@1',timebase:1000,cues,mawProject:m.project,offsetSeconds:0}}});context.project=project;inner({type:'maw.status',message:'字幕已保存'});}catch(error){inner({type:'maw.error',message:error.message});}}return;}
 if(e.source!==parent)return;if(m.type==='workstation.response'){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}}
 if(m.type==='workstation.context'){context=m;void sync();}
});
parent.postMessage({type:'workstation.request',id:crypto.randomUUID(),method:'context.get'},'*');
