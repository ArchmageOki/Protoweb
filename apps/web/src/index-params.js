(function(){
  const params = new URLSearchParams(location.search)
  if(params.get('registered')==='1'){
    const box = document.getElementById('postRegister')
    if(box) box.classList.remove('hidden')
  }
})()
