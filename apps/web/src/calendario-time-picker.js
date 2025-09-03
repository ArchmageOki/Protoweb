(function(){
  // Hacer que toda la barra de fecha sea táctil (wrapper clicable)
  const dateInput = document.getElementById('evt-fecha');
  const dateWrapper = document.querySelector('[data-date-wrapper]');
  if(dateInput && dateWrapper){
    dateWrapper.addEventListener('click', (e)=>{
      // Evitar doble apertura si el click es directamente en el input (nativo ya abre)
      if(e.target !== dateInput){
        if(typeof dateInput.showPicker === 'function'){
          try { dateInput.showPicker(); return; } catch {}
        }
        dateInput.focus();
        try { dateInput.click(); } catch {}
      }
    }, { passive:true });
  }
// ACTIVE no puede contener espacios para classList.toggle con segundo argumento.
const ACTIVE_BG = 'bg-slate-900';
const ACTIVE_TEXT = 'text-white';
  function buildHours(list){
    if(list.children.length) return;
    for(let h=0; h<24; h++){
      const li=document.createElement('li');
      const v=String(h).padStart(2,'0');
      li.textContent=v; li.dataset.hour=v;
      li.className='cursor-pointer rounded px-2 py-1 hover:bg-slate-100';
      list.appendChild(li);
    }
  }
  function positionPopover(id){
    const btn = document.querySelector(`[data-time-display="${id}"]`);
    const pop = document.querySelector(`[data-time-popover="${id}"]`);
    if(!btn || !pop) return;
    const container = btn.parentElement; // wrapper relativo
    const targetWidth = container ? container.offsetWidth : btn.offsetWidth;
    // Igualar ancho visual
    pop.style.width = targetWidth + 'px';
    pop.style.minWidth = targetWidth + 'px';
    // Posicionar justo debajo del botón
    pop.style.top = btn.offsetHeight + 'px';
    pop.style.left = '0px';
  }
  function openPopover(id){
    closeAll();
    const pop=document.querySelector(`[data-time-popover="${id}"]`);
    if(pop){
      pop.classList.remove('hidden');
      markActive(id);
      positionPopover(id);
      // Scroll automático a la hora por defecto (10 inicio / 11 fin) o la seleccionada
      try {
        const hourList = pop.querySelector('.time-hours');
        const hidden = document.getElementById(id);
        let hSel = hidden?.value?.split(':')[0];
        if(!hSel){ hSel = id==='evt-inicio' ? '10' : '11'; }
        const target = hourList?.querySelector(`[data-hour="${hSel}"]`);
        if(target && hourList){
          hourList.scrollTop = target.offsetTop - 8;
        }
      } catch {}
    }
  }
  function closeAll(){ document.querySelectorAll('.time-popover').forEach(p=>p.classList.add('hidden')); }
  function markActive(id){
    const hidden=document.getElementById(id); if(!hidden) return;
      const [h,m]=hidden.value.split(':');
      const pop=document.querySelector(`[data-time-popover="${id}"]`);
      if(!pop) return;
      pop.querySelectorAll('.time-hours [data-hour]').forEach(li=> {
        const on = li.dataset.hour===h;
        li.classList.toggle(ACTIVE_BG, on);
        li.classList.toggle(ACTIVE_TEXT, on);
      });
      pop.querySelectorAll('.time-minutes [data-minute]').forEach(li=> {
        const on = li.dataset.minute===m;
        li.classList.toggle(ACTIVE_BG, on);
        li.classList.toggle(ACTIVE_TEXT, on);
      });
  }
  function setTime(id,hour,minute,doClose){
    const hidden=document.getElementById(id); if(!hidden) return;
    hidden.value=`${hour}:${minute}`;
    const label=document.querySelector(`[data-time-display="${id}"] .time-value`);
    if(label) label.textContent=hidden.value;
    markActive(id);
    if(doClose) closeAll();
  }
  document.querySelectorAll('.time-hours').forEach(buildHours);
  document.querySelectorAll('[data-time-display]').forEach(btn=>{
    btn.addEventListener('click',e=>{ e.stopPropagation(); openPopover(btn.getAttribute('data-time-display')); });
  });
  document.addEventListener('click',e=>{
    const hourEl=e.target.closest('.time-hours [data-hour]');
    const minEl=e.target.closest('.time-minutes [data-minute]');
    if(hourEl){
      const pop=hourEl.closest('[data-time-popover]'); const id=pop.getAttribute('data-time-popover');
      const hidden=document.getElementById(id); const [,m]=hidden.value.split(':');
      setTime(id,hourEl.dataset.hour,m,false);
      positionPopover(id);
    }
    if(minEl){
      const pop=minEl.closest('[data-time-popover]'); const id=pop.getAttribute('data-time-popover');
      const hidden=document.getElementById(id); const [h]=hidden.value.split(':');
      setTime(id,h,minEl.dataset.minute,true);
    }
    if(e.target.matches('[data-action="close"]')) closeAll();
  });
  document.addEventListener('click', e=>{ if(!e.target.closest('.time-popover') && !e.target.closest('[data-time-display]')) closeAll(); });
  ['evt-inicio','evt-fin'].forEach(markActive);
  // Recalcular tamaño/posición en scroll y resize
  function syncOpen(){ document.querySelectorAll('.time-popover:not(.hidden)').forEach(p=>{ positionPopover(p.getAttribute('data-time-popover')); }); }
  window.addEventListener('resize', syncOpen);
  window.addEventListener('scroll', syncOpen, true);
})()
