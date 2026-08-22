"use strict";

class InspectorManager {
    constructor() {
        this.panel = null;
        this.lastClipId = null;
        this.ensurePanel();
        this.bindSelectionWatcher();
    }

    ensurePanel() {
        if (document.getElementById('sonicInspectorPanel')) { this.panel = document.getElementById('sonicInspectorPanel'); return; }
        this.panel = document.createElement('aside');
        this.panel.id = 'sonicInspectorPanel';
        this.panel.innerHTML = `<div class="si-head"><strong>Inspector</strong><button id="siReset">Reset</button></div><div id="siBody"><div class="si-empty">Select a clip to edit it.</div></div>`;
        Object.assign(this.panel.style,{position:'fixed',right:'16px',top:'80px',width:'280px',maxHeight:'calc(100vh - 110px)',overflow:'auto',zIndex:'900',padding:'16px',borderRadius:'14px',background:'rgba(20,20,28,.96)',color:'#fff',boxShadow:'0 12px 40px rgba(0,0,0,.35)',fontFamily:'system-ui,sans-serif'});
        document.body.appendChild(this.panel);
        document.getElementById('siReset')?.addEventListener('click',()=>this.reset());
    }

    bindSelectionWatcher() {
        document.addEventListener('click', e => { if (e.target.closest('.timeline-clip')) setTimeout(()=>this.render(),0); });
        setInterval(()=>{ const id=document.querySelector('.timeline-clip.selected')?.id||null; if(id!==this.lastClipId)this.render(); },300);
    }

    clip() {
        const el=document.querySelector('.timeline-clip.selected');
        if(!el||!window.TimelineManager)return null;
        const trackIndex=Number(el.dataset.trackIndex);
        return window.TimelineManager.getClips(trackIndex).find(c=>c.id===el.id)||null;
    }

    set(clip,key,value){ clip[key]=value; if(key==='volume')window.PlayerManager?.setVolume(value*100,clip); if(key==='pan')window.PlayerManager?.setPan(value,clip); if(key==='gain')window.PlayerManager?.setGain(value,clip); if(key==='muted')window.PlayerManager?.setMute(value,clip); if(key==='playbackRate')window.PlayerManager?.setPlaybackRate(value); if(['startTime','duration','endTime'].includes(key)){clip.endTime=clip.startTime+clip.duration; const el=document.getElementById(clip.id); if(el)window.TimelineManager.updateClipElement(el,clip); window.TimelineManager.updateTimelineWidth();} }

    range(label,key,value,min,max,step,suffix=''){return `<label class="si-row"><span>${label} <output>${Number(value).toFixed(2)}${suffix}</output></span><input data-key="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;}

    render(){
        const clip=this.clip(); this.lastClipId=clip?.id||null; const body=document.getElementById('siBody'); if(!body)return;
        if(!clip){body.innerHTML='<div class="si-empty">Select a clip to edit it.</div>';return;}
        const audio=clip.type==='audio'||clip.type==='video';
        body.innerHTML=`<div class="si-title">${this.escape(clip.name||'Untitled')}</div>${audio?`<section><h4>Audio</h4>${this.range('Volume','volume',(clip.volume??1)*100,0,100,1,'%')}${this.range('Gain','gain',clip.gain??1,0,2,.01,'x')}${this.range('Pan','pan',clip.pan??0,-1,1,.01,'')}<label class="si-check"><input data-key="muted" type="checkbox" ${clip.muted?'checked':''}> Mute</label>${this.range('Fade In','fadeIn',clip.fadeIn??0,0,10,.1,'s')}${this.range('Fade Out','fadeOut',clip.fadeOut??0,0,10,.1,'s')}</section>`:''}<section><h4>Transform</h4>${this.range('Opacity','opacity',(clip.opacity??1)*100,0,100,1,'%')}${this.range('Scale','scale',(clip.scale??1)*100,10,300,1,'%')}${this.range('Rotation','rotation',clip.rotation??0,-180,180,1,'°')}</section><section><h4>Playback</h4>${this.range('Speed','playbackRate',clip.playbackRate??1,.25,4,.05,'x')}</section>`;
        body.querySelectorAll('input[data-key]').forEach(input=>input.addEventListener('input',()=>{let key=input.dataset.key;let value=input.type==='checkbox'?input.checked:Number(input.value);if(key==='volume')value/=100;if(key==='opacity'||key==='scale')value/=100;this.set(clip,key,value);const out=input.parentElement.querySelector('output');if(out)out.textContent=`${Number(input.value).toFixed(2)}${input.dataset.key==='volume'||input.dataset.key==='opacity'||input.dataset.key==='scale'?'%':''}`;this.applyTransform(clip);}));
        this.applyTransform(clip);
    }

    applyTransform(clip){const video=document.getElementById('videoPreview');if(!video||clip.type!=='video')return;video.style.opacity=clip.opacity??1;video.style.transform=`scale(${clip.scale??1}) rotate(${clip.rotation??0}deg)`;}

    reset(){const clip=this.clip();if(!clip)return;Object.assign(clip,{volume:1,gain:1,pan:0,muted:false,fadeIn:0,fadeOut:0,opacity:1,scale:1,rotation:0,playbackRate:1});this.render();window.App?.notify?.('Inspector settings reset');}
    escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
}

window.InspectorManager=new InspectorManager();
