// Selector de emojis mejorado para WhatsApp
export function initEmojiPicker(emojiBtn, waSendMessageText, updateCharCounter) {
  if (!emojiBtn || !waSendMessageText) return

  emojiBtn.addEventListener('click', () => {
    // Emojis compatibles universalmente organizados por categorías
    const emojiCategories = {
      'Caras felices': [
        '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
        '🙂', '🙃', '😉', '😌', '😍', '😘', '😗', '😙', '😚', '😋'
      ],
      'Caras tristes': [
        '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '😢',
        '😭', '😤', '😠', '😡', '😳', '😱', '😨', '😰', '😥', '😓'
      ],
      'Gestos': [
        '🤔', '🤐', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😪',
        '😴', '😷', '🤒', '🤕', '😵', '🤠', '🤡', '🥳', '😎', '🤓'
      ],
      'Corazones': [
        '❤️', '💛', '💚', '💙', '💜', '🖤', '💔', '❣️', '💕', '💞',
        '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '💋', '💯', '💢'
      ],
      'Manos': [
        '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉',
        '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏'
      ],
      'Objetos': [
        '🎉', '🎊', '🎈', '🎁', '🎀', '🎂', '🍰', '☕', '🍵', '🍺',
        '🍻', '🥂', '🍷', '⭐', '🌟', '💫', '🚀', '⚡', '🔥', '💥'
      ]
    }
    
    // Crear popup de emojis estilo WhatsApp
    const existingPopup = document.getElementById('emojiPopup')
    if (existingPopup) {
      existingPopup.remove()
      return
    }
    
  const popup = document.createElement('div')
  popup.id = 'emojiPopup'
  popup.className = 'fixed bg-white border border-slate-200 rounded-lg shadow-lg text-lg z-50'
  popup.style.width = '420px'
  popup.style.maxHeight = '350px'
  popup.style.overflowY = 'auto'
  
  // Agregar flecha apuntando al botón
  const arrow = document.createElement('div')
  arrow.className = 'absolute -top-2 left-4 w-4 h-4 bg-white border-t border-l border-slate-200 transform rotate-45'
  popup.appendChild(arrow)  // Posicionar el popup relativo al botón de emoji
  const rect = emojiBtn.getBoundingClientRect()
  popup.style.left = `${rect.left}px`
  popup.style.top = `${rect.bottom + 8}px`
  
  // Ajustar posición si se sale de la pantalla
  const popupWidth = 420
  const popupHeight = 350
  
  // Ajuste horizontal
  if (rect.left + popupWidth > window.innerWidth) {
    popup.style.left = `${window.innerWidth - popupWidth - 10}px`
  }
  if (rect.left < 0) {
    popup.style.left = '10px'
  }
  
  // Ajuste vertical - si no cabe debajo, ponerlo arriba
  if (rect.bottom + popupHeight + 8 > window.innerHeight) {
    popup.style.top = `${rect.top - popupHeight - 8}px`
    popup.style.bottom = 'auto'
    // Cambiar la flecha para que apunte hacia abajo
    arrow.className = 'absolute -bottom-2 left-4 w-4 h-4 bg-white border-b border-r border-slate-200 transform rotate-45'
  }    // Crear categorías de emojis
    Object.entries(emojiCategories).forEach(([categoryName, emojis]) => {
      // Título de la categoría
      const categoryTitle = document.createElement('div')
      categoryTitle.className = 'sticky top-0 bg-white text-xs font-semibold text-slate-700 px-4 py-2 border-b border-slate-100'
      categoryTitle.textContent = categoryName
      popup.appendChild(categoryTitle)
      
      // Grid de emojis
      const emojiGrid = document.createElement('div')
      emojiGrid.className = 'grid grid-cols-10 gap-2 p-3'
      
      emojis.forEach(emoji => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = emoji
        btn.className = 'hover:bg-slate-100 w-8 h-8 rounded flex items-center justify-center transition-colors text-xl hover:scale-110'
        btn.addEventListener('click', () => {
          const textarea = waSendMessageText
          const start = textarea.selectionStart
          const end = textarea.selectionEnd
          const text = textarea.value
          textarea.value = text.slice(0, start) + emoji + text.slice(end)
          textarea.setSelectionRange(start + emoji.length, start + emoji.length)
          textarea.focus()
          updateCharCounter()
          popup.remove()
        })
        emojiGrid.appendChild(btn)
      })
      
      popup.appendChild(emojiGrid)
    })
    
    document.body.appendChild(popup)
  })

  // Cerrar popup de emojis al hacer clic fuera, redimensionar o hacer scroll
  const closePopup = (e) => {
    const popup = document.getElementById('emojiPopup')
    if (popup && !emojiBtn.contains(e.target) && !popup.contains(e.target)) {
      popup.remove()
    }
  }

  const removePopup = () => {
    const popup = document.getElementById('emojiPopup')
    if (popup) popup.remove()
  }

  document.addEventListener('click', closePopup)
  window.addEventListener('resize', removePopup)
  window.addEventListener('scroll', removePopup)
}
