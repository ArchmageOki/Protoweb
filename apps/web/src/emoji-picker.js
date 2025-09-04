import { EMOJI_CATEGORIES } from "./emoji-data.js";

// Selector de emojis mejorado para WhatsApp
export function initEmojiPicker(
  emojiBtn,
  waSendMessageText,
  updateCharCounter
) {
  if (!emojiBtn || !waSendMessageText) return;

  emojiBtn.addEventListener("click", () => {
    const emojiCategories = {};
    EMOJI_CATEGORIES.forEach((cat) => {
      emojiCategories[cat.name] = cat.emojis;
    });

    // Crear popup de emojis estilo WhatsApp
    const existingPopup = document.getElementById("emojiPopup");
    if (existingPopup) {
      existingPopup.remove();
      return;
    }

    const popup = document.createElement("div");
    popup.id = "emojiPopup";
    popup.className =
      "fixed bg-white border border-slate-200 rounded-lg shadow-lg text-lg z-50";
    popup.style.width = "420px";
    popup.style.maxHeight = "350px";
    popup.style.overflowY = "auto";

    // Agregar flecha apuntando al botón
    const arrow = document.createElement("div");
    arrow.className =
      "absolute -top-2 left-4 w-4 h-4 bg-white border-t border-l border-slate-200 transform rotate-45";
    popup.appendChild(arrow); // Posicionar el popup relativo al botón de emoji
    const rect = emojiBtn.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 8}px`;

    // Ajustar posición si se sale de la pantalla
    const popupWidth = 420;
    const popupHeight = 350;

    // Ajuste horizontal
    if (rect.left + popupWidth > window.innerWidth) {
      popup.style.left = `${window.innerWidth - popupWidth - 10}px`;
    }
    if (rect.left < 0) {
      popup.style.left = "10px";
    }

    // Ajuste vertical - si no cabe debajo, ponerlo arriba
    if (rect.bottom + popupHeight + 8 > window.innerHeight) {
      popup.style.top = `${rect.top - popupHeight - 8}px`;
      popup.style.bottom = "auto";
      // Cambiar la flecha para que apunte hacia abajo
      arrow.className =
        "absolute -bottom-2 left-4 w-4 h-4 bg-white border-b border-r border-slate-200 transform rotate-45";
    }

    // Contenedor para barra de búsqueda
    const searchWrapper = document.createElement("div");
    searchWrapper.className =
      "sticky top-0 bg-white p-2 border-b border-slate-200";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Buscar emoji... (corazon, mano, check, etc.)";
    searchInput.className =
      "w-full rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring focus:ring-indigo-200";
    searchWrapper.appendChild(searchInput);
    popup.appendChild(searchWrapper);

    // Contenedor scrollable de categorías / resultados
    const categoriesContainer = document.createElement("div");
    popup.appendChild(categoriesContainer);

    // Keywords adicionales manuales
    const EXTRA_KEYWORDS = {
      "❤️": ["corazon", "amor", "love", "heart", "rojo"],
      "💔": ["corazon", "roto", "broken", "heart"],
      "💕": ["corazones", "love", "hearts"],
      "✅": ["check", "ok", "aceptar", "confirmar", "sí", "si"],
      "✔️": ["check", "tick", "marcar", "ok"],
      "❌": ["x", "cerrar", "equivocado", "no", "error"],
      "❎": ["x", "boton", "negativo"],
      "👍": ["pulgar", "arriba", "like", "ok", "bien"],
      "👎": ["pulgar", "abajo", "mal", "dislike", "no"],
      "🙏": ["gracias", "please", "por favor", "rezar", "pray"],
      "😂": ["risa", "laugh", "lol", "gracioso"],
      "🤣": ["risa", "laugh", "lol", "gracioso", "suelo"],
      "🙂": ["sonrisa", "smile", "neutral"],
      "😉": ["guiño", "wink"],
      "😢": ["llorar", "triste", "cry"],
      "😭": ["llorar", "triste", "cry", "lagrimas"],
      "😡": ["enojado", "furia", "angry"],
      "🔥": ["fuego", "fire", "hot"],
      "⭐": ["estrella", "star"],
      "✨": ["brillo", "sparkles", "shine"],
      "🎉": ["fiesta", "party", "celebrar"],
      "🎂": ["tarta", "pastel", "cumple", "birthday", "cake"],
      "🍰": ["pastel", "postre", "cake"],
      "🍕": ["pizza", "comida"],
      "🥳": ["fiesta", "party", "celebrar"],
      "😎": ["gafas", "cool"],
      "🤔": ["pensar", "think", "hmm"],
      "💪": ["fuerza", "strong", "musculo"],
      "⚠️": ["alerta", "warning", "cuidado"],
      "🚀": ["cohete", "rocket", "lanzar", "startup"],
      "📞": ["telefono", "llamar", "call"],
      "📅": ["calendario", "fecha", "calendar"],
      "🕒": ["reloj", "hora", "tiempo", "clock"],
      "💰": ["dinero", "money", "pago", "cash"],
      "💸": ["dinero", "money", "vuela"],
      "💼": ["trabajo", "work", "maletin"],
      "🛠️": ["herramientas", "tools", "config"],
      "📝": ["nota", "escribir", "write"],
      "✏️": ["lapiz", "escribir", "pencil"],
    };

    // Construir índice para búsqueda
    const SEARCH_INDEX = [];
    Object.entries(emojiCategories).forEach(([categoryName, emojis]) => {
      emojis.forEach((e) => {
        SEARCH_INDEX.push({
          emoji: e,
          category: categoryName,
          keywords: [categoryName.toLowerCase(), ...(EXTRA_KEYWORDS[e] || [])],
        });
      });
    });

    function renderCategories() {
      categoriesContainer.innerHTML = "";
      Object.entries(emojiCategories).forEach(([categoryName, emojis]) => {
        const categoryTitle = document.createElement("div");
        categoryTitle.className =
          "sticky top-0 bg-white text-xs font-semibold text-slate-700 px-4 py-2 border-b border-slate-100";
        categoryTitle.textContent = categoryName;
        categoriesContainer.appendChild(categoryTitle);
        const emojiGrid = document.createElement("div");
        emojiGrid.className = "grid grid-cols-10 gap-2 p-3";
        emojis.forEach((emoji) => emojiGrid.appendChild(makeEmojiBtn(emoji)));
        categoriesContainer.appendChild(emojiGrid);
      });
    }

    function makeEmojiBtn(emoji) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = emoji;
      btn.className =
        "hover:bg-slate-100 w-8 h-8 rounded flex items-center justify-center transition-colors text-xl hover:scale-110";
      btn.addEventListener("click", () => {
        const textarea = waSendMessageText;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        textarea.value = text.slice(0, start) + emoji + text.slice(end);
        textarea.setSelectionRange(start + emoji.length, start + emoji.length);
        textarea.focus();
        updateCharCounter();
        popup.remove();
      });
      return btn;
    }

    function renderSearchResults(term) {
      categoriesContainer.innerHTML = "";
      const norm = term.toLowerCase();
      const results = SEARCH_INDEX.filter((entry) =>
        entry.keywords.some((k) => k.includes(norm))
      );
      const title = document.createElement("div");
      title.className =
        "sticky top-0 bg-white text-xs font-semibold text-slate-700 px-4 py-2 border-b border-slate-100";
      title.textContent = `Resultados (${results.length})`;
      categoriesContainer.appendChild(title);
      const grid = document.createElement("div");
      grid.className = "grid grid-cols-10 gap-2 p-3";
      results.forEach((r) => grid.appendChild(makeEmojiBtn(r.emoji)));
      categoriesContainer.appendChild(grid);
      if (results.length === 0) {
        const empty = document.createElement("div");
        empty.className = "px-4 pb-4 text-xs text-slate-500";
        empty.textContent = "Sin coincidencias";
        categoriesContainer.appendChild(empty);
      }
    }

    let searchDebounce;
    searchInput.addEventListener("input", (e) => {
      clearTimeout(searchDebounce);
      const val = e.target.value.trim();
      searchDebounce = setTimeout(() => {
        if (!val) {
          renderCategories();
        } else {
          renderSearchResults(val);
        }
      }, 150);
    });

    renderCategories();
    document.body.appendChild(popup);
  });

  // Cerrar popup de emojis al hacer clic fuera, redimensionar o hacer scroll
  const closePopup = (e) => {
    const popup = document.getElementById("emojiPopup");
    if (popup && !emojiBtn.contains(e.target) && !popup.contains(e.target)) {
      popup.remove();
    }
  };

  const removePopup = () => {
    const popup = document.getElementById("emojiPopup");
    if (popup) popup.remove();
  };

  document.addEventListener("click", closePopup);
  window.addEventListener("resize", removePopup);
  window.addEventListener("scroll", removePopup);
}
