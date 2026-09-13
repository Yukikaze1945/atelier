// AGPL-3.0 workstation adaptation. Exposes a project timeline as MAW's media clock.
window.WorkstationTimelinePlayer = class {
  constructor(element,onError) {
    this.element=element;this.onError=onError;this.time=0;this.running=false;this.voices=new Map();this.duration=0;this.masterMuted=false;this.frame=0;
    const proto=HTMLMediaElement.prototype;
    this.native={};for(const key of ['currentTime','duration','paused','readyState','seeking','ended','muted'])this.native[key]=Object.getOwnPropertyDescriptor(proto,key);
    const parent=element.parentElement;parent.style.position='relative';
    this.surface=document.createElement('div');this.surface.className='workstation-video-surface';parent.append(this.surface);
    Object.defineProperties(element,{
      currentTime:{configurable:true,get:()=>this.time,set:value=>this.seek(Number(value))},
      duration:{configurable:true,get:()=>this.duration},paused:{configurable:true,get:()=>!this.running},ended:{configurable:true,get:()=>this.duration>0&&this.time>=this.duration},
      currentSrc:{configurable:true,get:()=>this.duration?'workstation:timeline':''},
      readyState:{configurable:true,get:()=>this.duration?2:0},
      seekable:{configurable:true,get:()=>({length:this.duration?1:0,start:()=>0,end:()=>this.duration})},
      muted:{configurable:true,get:()=>this.masterMuted,set:value=>{this.masterMuted=Boolean(value);this.sync();}},
    });
    element.play=async()=>{if(!this.duration)return;if(this.time>=this.duration)this.seek(0);this.running=true;this.sync();element.dispatchEvent(new Event('play'));this.last=performance.now();cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(t=>this.tick(t));};
    element.pause=()=>{this.running=false;for(const v of this.voices.values())v.element.pause();cancelAnimationFrame(this.frame);element.dispatchEvent(new Event('pause'));};
    element.addEventListener('volumechange',()=>this.sync());
  }
  setTimeline(timeline,assets){this.element.pause();this.timeline=timeline;this.assets=new Map(assets.map(a=>[a.id,a]));this.duration=Math.max(0,...timeline.clips.map(c=>(c.startTicks+c.durationTicks)/timeline.timebase));this.element.style.aspectRatio=`${timeline.width}/${timeline.height}`;this.seek(Math.min(this.time,this.duration));this.element.dispatchEvent(new Event('loadedmetadata'));this.element.dispatchEvent(new Event('durationchange'));this.element.dispatchEvent(new Event('canplay'));}
  seek(value){if(!Number.isFinite(value))return;this.time=Math.max(0,Math.min(this.duration,value));this.sync(true);this.element.dispatchEvent(new Event('timeupdate'));this.element.dispatchEvent(new Event('seeked'));this.onTime?.();}
  sync(seek=false){
    if(!this.timeline)return;const t=this.timeline,at=Math.min(this.time,Math.max(0,this.duration-0.00001));
    const active=t.clips.filter(c=>!c.disabled&&c.startTicks/t.timebase<=at&&(c.startTicks+c.durationTicks)/t.timebase>at);
    const visual=t.tracks.filter(tr=>tr.kind==='video'&&!tr.disabled).map(tr=>active.filter(c=>c.trackId===tr.id).at(-1)).find(Boolean);
    const solo=t.tracks.some(tr=>tr.kind==='audio'&&tr.solo);
    const audio=active.filter(c=>t.tracks.some(tr=>tr.id===c.trackId&&tr.kind==='audio'&&!tr.disabled&&!tr.muted&&(!solo||tr.solo)));
    const wanted=[...(visual?[visual]:[]),...audio],ids=new Set(wanted.map(c=>c.id));
    for(const [id,v] of this.voices)if(!ids.has(id)){v.element.pause?.();v.element.removeAttribute('src');v.element.load?.();v.element.remove();this.voices.delete(id);}
    this.clock=null;
    for(const c of wanted){const a=this.assets.get(c.assetId);if(!a?.url)continue;const isVisual=c.id===visual?.id;let voice=this.voices.get(c.id);
      if(voice&&voice.url!==a.url){voice.element.pause?.();voice.element.remove();this.voices.delete(c.id);voice=null;}
      if(!voice){const tag=isVisual?(a.mediaType==='image'?'img':'video'):'audio';const media=document.createElement(tag);voice={element:media,clip:c,url:a.url};this.voices.set(c.id,voice);
        if(tag==='img'){media.src=a.url;this.surface.append(media);}else{
          media.preload='auto';media.playsInline=true;media.src=a.url;
          const align=()=>{if(this.voices.get(c.id)!==voice)return;const current=voice.clip;const desired=Math.max(0,this.time-current.startTicks/this.timeline.timebase+current.inTicks/this.timeline.timebase);if(Math.abs(media.currentTime-desired)>.03)media.currentTime=Math.min(desired,Math.max(0,media.duration-.001));};
          media.addEventListener('loadedmetadata',align);media.addEventListener('error',()=>{if(this.voices.get(c.id)===voice)this.fail('时间线素材无法预览：'+a.name);});
          if(isVisual)this.surface.append(media);else this.surface.append(media);
        }
      }
      const media=voice.element;voice.clip=c;
      if(media instanceof HTMLMediaElement){media.volume=this.element.volume;media.playbackRate=this.element.playbackRate;const track=t.tracks.find(tr=>tr.id===c.trackId);
        media.muted=this.masterMuted || (isVisual&&(Boolean(c.linkGroup)||Boolean(track?.muted)||solo));
        if(seek&&media.readyState>=1){const desired=Math.max(0,this.time-c.startTicks/t.timebase+c.inTicks/t.timebase);if(Math.abs(media.currentTime-desired)>.03)media.currentTime=Math.min(desired,Math.max(0,media.duration-.001));}
        if(!this.clock || isVisual)this.clock=voice;
      }
    }
    const waiting=Boolean(this.clock&&(this.clock.element.readyState<2||this.clock.element.seeking));
    for(const voice of this.voices.values()){const media=voice.element;if(!(media instanceof HTMLMediaElement))continue;
      if(!this.running||waiting){media.pause();continue;}
      if(this.waiting&&voice!==this.clock&&media.readyState>=1){const c=voice.clip,desired=Math.max(0,this.time-c.startTicks/t.timebase+c.inTicks/t.timebase);if(Math.abs(media.currentTime-desired)>.03)media.currentTime=Math.min(desired,Math.max(0,media.duration-.001));}
      if(media.readyState>=2)this.playVoice(voice);
    }
    this.waiting=waiting;
  }
  fail(message){this.element.pause();this.onError(message);}
  playVoice(voice){const m=voice.element;if(!this.running||!m.paused||voice.pending)return;voice.pending=m.play().catch(e=>{if(e.name!=='AbortError'&&this.voices.get(voice.clip.id)===voice)this.fail(e.message);}).finally(()=>{voice.pending=null;});}
  tick(now){if(!this.running)return;const elapsed=Math.min(.2,(now-this.last)/1000);this.last=now;let next=this.time;
    if(this.clock){const {element:m,clip:c}=this.clock,t=this.timeline;const end=(c.startTicks+c.durationTicks)/t.timebase;if(m.ended)next=end;else if(m.readyState>=2&&!m.seeking)next=Math.min(end,c.startTicks/t.timebase+m.currentTime-c.inTicks/t.timebase);}
    else next+=elapsed*this.element.playbackRate;
    this.time=Math.max(0,Math.min(this.duration,next));this.sync();this.element.dispatchEvent(new Event('timeupdate'));this.onTime?.();
    if(this.time>=this.duration){this.element.pause();this.element.dispatchEvent(new Event('ended'));return;}this.frame=requestAnimationFrame(t=>this.tick(t));
  }
  destroy(){this.element.pause();for(const v of this.voices.values()){v.element.pause?.();v.element.remove();}this.voices.clear();}
};
