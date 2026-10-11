(function(){
  if(/^\/services\/?$/.test(location.pathname)&&/^#(events|event-growth)$/.test(location.hash)){location.replace('/event-growth/');return;}
  var hb=document.getElementById('hamburger'), menu=document.getElementById('mobile-menu');
  if(hb){hb.addEventListener('click',function(){
    var open=menu.classList.toggle('open'); hb.setAttribute('aria-expanded',open);
    var s=hb.querySelectorAll('span');
    if(open){s[0].style.transform='rotate(45deg) translate(4px, 5px)';s[1].style.opacity='0';s[2].style.transform='rotate(-45deg) translate(4px, -5px)';}
    else{s.forEach(function(x){x.style.transform='';x.style.opacity='';});}
  });}
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('visible');io.unobserve(e.target);}});},{threshold:0.1,rootMargin:'0px 0px -40px 0px'});
  document.querySelectorAll('.fade-in').forEach(function(el){io.observe(el);});
  var nav=document.querySelector('nav');
  addEventListener('scroll',function(){nav.style.boxShadow=scrollY>20?'0 1px 0 var(--rule), 0 4px 24px rgba(14,12,9,0.06)':'';},{passive:true});
  // Tabs
  var tabs=[].slice.call(document.querySelectorAll('[role="tab"]'));
  if(!tabs.length) return;
  function select(id,focus,push){
    tabs.forEach(function(t){var on=t.dataset.tab===id;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;
      document.getElementById('panel-'+t.dataset.tab).hidden=!on; if(on&&focus)t.focus();});
    if(push) history.replaceState(null,'','#'+id);
    document.querySelectorAll('#panel-'+id+' .fade-in').forEach(function(el){el.classList.add('visible');});
  }
  tabs.forEach(function(t,i){
    t.addEventListener('click',function(){select(t.dataset.tab,false,true);});
    t.addEventListener('keydown',function(e){var n=null;
      if(e.key==='ArrowRight')n=(i+1)%tabs.length; else if(e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;
      else if(e.key==='Home')n=0; else if(e.key==='End')n=tabs.length-1;
      if(n!==null){e.preventDefault();select(tabs[n].dataset.tab,true,true);}});
  });
  function fromHash(){var h=location.hash.slice(1);if(tabs.some(function(t){return t.dataset.tab===h;}))select(h,false,false);}
  addEventListener('hashchange',fromHash);
  document.querySelectorAll('a[href^="/services/#"]').forEach(function(a){a.addEventListener('click',function(e){
    var h=a.getAttribute('href').split('#')[1]; if(location.pathname.indexOf('/services')===0){e.preventDefault();select(h,false,true);document.querySelector('.tabs-bar').scrollIntoView({behavior:'smooth'});}});});
  fromHash();
})();
