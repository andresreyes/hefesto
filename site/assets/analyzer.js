// Hefesto — analizador estático de artefactos de agente.
// Corre entero en el navegador: el archivo nunca sale de la máquina del usuario.
//
// Dos rúbricas, porque los dos artefactos tienen formas correctas distintas:
// un prompt de rol correcto es corto y sin procedimiento; una skill correcta
// es larga y sin números. Una sola rúbrica reprobaría a los dos.
(function () {
  "use strict";

  function ok(t, l)    { return { estado: "ok", detalle: t, lineas: l }; }
  function aviso(t, l) { return { estado: "aviso", detalle: t, lineas: l }; }
  function falla(t, l) { return { estado: "falla", detalle: t, lineas: l }; }

  // ── parseo ──────────────────────────────────────────────────────────────
  function parsear(texto) {
    var fm = {}, cuerpo = texto, offset = 0;
    var m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (m) {
      cuerpo = texto.slice(m[0].length);
      offset = m[0].split(/\r?\n/).length - 1;
      m[1].split(/\r?\n/).forEach(function (l) {
        var kv = l.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
        if (kv) fm[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
      });
    }
    var lineas = cuerpo.split(/\r?\n/);
    // prosa = cuerpo sin bloques de código. Un número dentro de un comando de
    // ejemplo es legítimo; uno en prosa es un umbral fuera de su capa.
    var dentro = false;
    var prosa = lineas.map(function (l) {
      if (/^\s*```/.test(l)) { dentro = !dentro; return ""; }
      return dentro ? "" : l;
    });
    return {
      fm: fm, cuerpo: cuerpo, texto: texto, lineas: lineas,
      prosa: prosa, prosaTexto: prosa.join("\n"), offset: offset,
      bloques: Math.floor((cuerpo.match(/```/g) || []).length / 2)
    };
  }

  // ── detección de tipo ───────────────────────────────────────────────────
  function detectar(d, archivo) {
    var p = 0, s = 0;
    // La ruta es la señal más fuerte y la que no se puede falsear: un prompt de
    // rol mal escrito trae procedimiento dentro y, sin esto, se clasificaría
    // como skill — escapando justo de la regla que lo condena.
    var nom = (archivo || "").toLowerCase();
    if (/skill\.md$/.test(nom)) return { tipo: "skill", confianza: "por ruta" };
    if (/(^|\/)(agents?|roles?)\//.test(nom) || /^(lider-tecnico|arquitecto|constructor|pruebas|seguridad|sre|devops|verificador)\.md$/.test(nom)) {
      return { tipo: "prompt", confianza: "por ruta" };
    }
    if (d.fm.tools) p += 4;
    if (/^\s*Eres (el|la) (rol|agente)/im.test(d.cuerpo)) p += 4;
    if (/carga la skill|s[íi]guela/i.test(d.cuerpo)) p += 3;
    if (d.lineas.length <= 30) p += 2;

    if (/^#{1,3}\s*(paso|step)\s*\d/im.test(d.cuerpo)) s += 4;
    if (/^#{1,3}\s*(entrada|salida|procedimiento|reglas)/im.test(d.cuerpo)) s += 3;
    if (d.bloques >= 2) s += 2;
    if (d.lineas.length > 45) s += 3;

    if (p === s) return { tipo: "skill", confianza: "baja" };
    var dif = Math.abs(p - s);
    return {
      tipo: p > s ? "prompt" : "skill",
      confianza: dif >= 5 ? "alta" : dif >= 3 ? "media" : "baja"
    };
  }

  // ── detectores compartidos ──────────────────────────────────────────────
  // Regla número uno del framework: ningún número vive dentro de una
  // instrucción. El umbral va en gates.yaml, donde un script lo lee.
  var RE_UMBRAL = /\b(m[íi]nim[oa]|m[áa]xim[oa]|al menos|no m[áa]s de|no menos de|umbral|tope|l[íi]mite|cobertura|timeout|reintent\w*|severidad)\b[^.\n]{0,40}?\d+(?:[.,]\d+)?\s*(?:%|s\b|seg\w*|min\w*|ms\b|MB|GB|veces|d[íi]as)?/i;
  var RE_PCT = /\b\d{1,3}\s?%/;

  function lineasQue(d, re, lim) {
    var out = [];
    for (var i = 0; i < d.prosa.length && out.length < (lim || 4); i++) {
      var l = d.prosa[i];
      if (!l.trim() || /^\s*(#|>|\|)/.test(l)) continue;
      // documentación de un flag, o una fórmula: no es un umbral negociado en prosa
      if (/(^|[\s`(])--[a-z][\w-]*/i.test(l)) continue;
      if (/=\s*[\d(]/.test(l) || /^\s*[-*]?\s*`?[a-z_]+`?\s*=/i.test(l)) continue;
      if (re.test(l)) out.push({ n: i + 1 + d.offset, texto: l.trim().slice(0, 120) });
    }
    return out;
  }

  function umbrales(d) {
    var vistos = {}, out = [];
    lineasQue(d, RE_UMBRAL, 4).concat(lineasQue(d, RE_PCT, 4)).forEach(function (x) {
      if (!vistos[x.n]) { vistos[x.n] = 1; out.push(x); }
    });
    return out.sort(function (a, b) { return a.n - b.n; }).slice(0, 4);
  }

  // Regla de cierre: nada después de la tarea. El proxy estático es una
  // sección final corta que solo repite reglas o recuerda formato.
  function cola(d) {
    var ult = d.cuerpo.split(/^#{2,3}\s+/m).pop() || "";
    if (!/\b(recuerda|no olvides|importante:|siempre debes|repito|formato de respuesta)\b/i.test(ult)) return null;
    if (ult.split(/\s+/).length > 220) return null;
    return (ult.trim().split(/\r?\n/).filter(Boolean)[0] || null);
  }

  function credencial(d) {
    return d.texto.match(/\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|contrase[nñ]a|api[_-]?key|token)\s*[:=]\s*["']?[^\s"']{10,})/i);
  }
  function destructivo(d) {
    return d.texto.match(/(rm\s+-rf\s+\/(?!tmp)|git\s+push\s+--force(?!-with-lease)|DROP\s+TABLE|kubectl\s+delete\s+ns|--dangerously\S*|curl[^\n]*\|\s*(?:ba)?sh)/i);
  }

  var VAGO = /\b(ayuda con|maneja|gestiona|trabaja con|relacionado con|entre otras|etc\.?|cosas|lo necesario)\b/i;
  var CUANDO = /\b(usa|[úu]salo|usar|cuando|si el usuario|al pedir|inv[óo]calo|tras un)\b/i;
  var IMPERATIVO = /^\s*(?:\d+\.|[-*])?\s*(corre|ejecuta|lee|escribe|crea|revisa|valida|genera|copia|abre|verifica|compara|renderiza|consulta|emite|registra)\b/im;

  // ── rúbrica: SKILL.md ───────────────────────────────────────────────────
  var R_SKILL = [
    { eje: "disparo", peso: 2, n: "Nombre en el frontmatter", f: function (d) {
      return d.fm.name ? ok(d.fm.name) : falla("Falta el campo name."); } },
    { eje: "disparo", peso: 3, n: "Tiene descripción", f: function (d) {
      return d.fm.description ? ok("Presente.") : falla("Sin description, ningún harness sabe cuándo cargarla."); } },
    { eje: "disparo", peso: 3, n: "La descripción dice cuándo usarla", f: function (d) {
      var s = d.fm.description || "";
      if (!s) return falla("No hay descripción que evaluar.");
      return CUANDO.test(s) ? ok("Incluye condiciones de uso.")
        : falla("Dice qué hace, no cuándo dispararla. Agrega situaciones concretas."); } },
    { eje: "disparo", peso: 2, n: "Longitud útil de la descripción", f: function (d) {
      var n = (d.fm.description || "").length;
      if (!n) return falla("Vacía.");
      if (n < 80) return aviso(n + " caracteres. Corta para competir con otras skills; suele no disparar.");
      if (n > 900) return aviso(n + " caracteres. Mueve el detalle al cuerpo.");
      return ok(n + " caracteres."); } },
    { eje: "disparo", peso: 2, n: "Sin lenguaje vago", f: function (d) {
      var m = (d.fm.description || "").match(VAGO);
      return m ? aviso("Aparece «" + m[0] + "»: dispara de más o de menos.") : ok("Sin muletillas."); } },

    { eje: "procedimiento", peso: 3, n: "Declara entrada y salida", f: function (d) {
      var e = /\b(entrada|consume|recibe|insumo)\b/i.test(d.cuerpo);
      var s = /\b(salida|produce|entrega|genera|artefacto)\b/i.test(d.cuerpo);
      if (e && s) return ok("Qué consume y qué produce están declarados.");
      if (e || s) return aviso("Declara solo " + (e ? "la entrada" : "la salida") + "; falta la otra mitad del contrato.");
      return falla("No declara qué consume ni qué produce. Sin contrato no hay handoff verificable."); } },
    { eje: "procedimiento", peso: 3, n: "Pasos accionables", f: function (d) {
      return IMPERATIVO.test(d.cuerpo) ? ok("Los pasos arrancan con verbo imperativo.")
        : falla("Describe en vez de instruir. Empieza cada paso con un verbo."); } },
    { eje: "procedimiento", peso: 2, n: "Comandos concretos", f: function (d) {
      return d.bloques >= 1 ? ok(d.bloques + " bloque(s) de código.")
        : aviso("Sin bloques de código. Si hay que ejecutar algo, escribe el comando exacto."); } },
    { eje: "procedimiento", peso: 2, n: "Condición de aborto", f: function (d) {
      return /\b(si no|en caso de|cuando no|si falla|si est[áa] vac[íi]o|si es 0|detente|no contin[úu]es|aborta)\b/i.test(d.cuerpo)
        ? ok("Contempla al menos un camino de fallo.")
        : aviso("No dice qué hacer cuando algo falla o viene vacío. El agente improvisará ahí."); } },
    { eje: "procedimiento", peso: 2, n: "Estructura navegable", f: function (d) {
      var h = (d.cuerpo.match(/^#{2,3}\s+/gm) || []).length;
      if (!h) return aviso("Sin secciones. Difícil de seguir a mitad de tarea.");
      if (h > 14) return aviso(h + " secciones. Considera partirla en varias skills.");
      return ok(h + " secciones."); } },

    { eje: "ubicacion", peso: 5, n: "Ningún número vive en la instrucción", f: function (d) {
      var h = umbrales(d);
      return h.length ? falla("Hay " + h.length + " umbral(es) escritos en prosa. Van en gates.yaml, donde un script los lee.", h)
        : ok("Sin umbrales incrustados."); } },
    { eje: "ubicacion", peso: 3, n: "Referencia sus gates por nombre", f: function (d) {
      var g = d.cuerpo.match(/\bG\d+[a-z]?_[a-z_]+\b/gi) || [];
      if (g.length) return ok("Nombra " + g.length + " gate(s): " + g.slice(0, 3).join(", "));
      return /gates\.yaml/i.test(d.cuerpo)
        ? aviso("Menciona gates.yaml pero no nombra ningún gate; no hay nada que cruzar contra el archivo.")
        : aviso("No referencia gates. Si nada la cierra con un umbral, nada comprueba que se cumplió."); } },
    { eje: "ubicacion", peso: 3, n: "Reutilizable entre equipos", f: function (d) {
      var m = d.prosaTexto.match(/\b(nuestr[oa]s?|nuestro equipo|en la compa[ñn][íi]a|en el banco|el equipo de [A-ZÁÉÍÓÚ]\w+)\b/i);
      return m ? aviso("Aparece «" + m[0] + "». El contexto de organización va en CLAUDE.md; aquí impide compartir la skill.")
        : ok("Sin contexto atado a un equipo."); } },
    { eje: "ubicacion", peso: 2, n: "Nada después de la tarea", f: function (d) {
      var c = cola(d);
      return c ? aviso("Cierra con un recordatorio: «" + c.slice(0, 70) + "». Empuja la tarea al medio de la ventana; si la regla es crítica, va arriba.")
        : ok("No hay coletilla al final."); } },

    { eje: "seguridad", peso: 4, n: "Sin credenciales", f: function (d) {
      return credencial(d) ? falla("Parece haber una credencial en el archivo. Sácala.") : ok("Sin secretos en texto plano."); } },
    { eje: "seguridad", peso: 3, n: "Comandos destructivos acotados", f: function (d) {
      var m = destructivo(d);
      return m ? falla("Contiene «" + m[0].trim().slice(0, 40) + "» sin guardarraíl.") : ok("Sin destructivos sueltos."); } },
    { eje: "seguridad", peso: 2, n: "Declara dónde escribe", f: function (d) {
      if (!/\b(escrib|genera|crea)\w*/i.test(d.cuerpo)) return ok("No produce artefactos.");
      return /(mktemp|TMPDIR|\/tmp|directorio temporal|REPORT_DIR)/i.test(d.cuerpo)
        ? ok("Usa un directorio acotado.") : aviso("Genera archivos pero no dice dónde."); } }
  ];

  // ── rúbrica: prompt de rol ──────────────────────────────────────────────
  var R_PROMPT = [
    { eje: "identidad", peso: 2, n: "Nombre en el frontmatter", f: function (d) {
      return d.fm.name ? ok(d.fm.name) : falla("Falta el campo name."); } },
    { eje: "identidad", peso: 3, n: "Descripción con condición de invocación", f: function (d) {
      var s = d.fm.description || "";
      if (!s) return falla("Sin description: nada indica cuándo invocar el rol.");
      return CUANDO.test(s) ? ok("Dice cuándo invocarlo.") : falla("No dice cuándo invocarlo."); } },
    { eje: "identidad", peso: 3, n: "Identidad en una frase", f: function (d) {
      return /^\s*Eres (el|la)\b/im.test(d.cuerpo) ? ok("Declara quién es el rol.")
        : aviso("No abre declarando la identidad. Es la primera de las tres preguntas que un prompt de rol responde."); } },
    { eje: "identidad", peso: 2, n: "Responde una pregunta propia", f: function (d) {
      return /\bRespondes:|\bTu pregunta\b|\?\s*$/im.test(d.cuerpo)
        ? ok("El rol tiene una pregunta que le pertenece.")
        : aviso("No formula qué pregunta resuelve este rol y no los vecinos."); } },

    { eje: "frontera", peso: 4, n: "Declara qué NO hace", f: function (d) {
      return /\bno\s+(dise[ñn]as|implementas|despliegas|corriges|decides|ejecutas|lees|haces)\b/i.test(d.cuerpo)
        ? ok("La frontera con los roles vecinos está escrita.")
        : falla("No dice qué NO hace. Sin frontera, el rol absorbe el trabajo del vecino y el alcance crece en silencio."); } },
    { eje: "frontera", peso: 4, n: "Declara sus herramientas", f: function (d) {
      if (!d.fm.tools) return falla("Sin línea tools:. Es un control real, no decoración: define qué puede ejecutar el subagente.");
      var t = d.fm.tools.split(/,\s*/).filter(Boolean);
      if (t.length > 12) return aviso(t.length + " herramientas. Cada una ocupa contexto aunque no se use.");
      return ok(t.length + " herramientas: " + d.fm.tools.slice(0, 60)); } },
    { eje: "frontera", peso: 3, n: "Ordena cargar su skill", f: function (d) {
      return /carga la skill|s[íi]guela/i.test(d.cuerpo) ? ok("Delega el procedimiento a la skill.")
        : falla("No manda cargar ninguna skill. O el procedimiento está aquí dentro, o el rol no tiene procedimiento."); } },
    { eje: "frontera", peso: 3, n: "Longitud de prompt de rol", f: function (d) {
      var n = d.lineas.filter(function (l) { return l.trim(); }).length;
      if (n > 35) return falla(n + " líneas. Un prompt de rol responde tres preguntas y cabe en unas 12–23; el resto pertenece a otra capa.");
      if (n > 25) return aviso(n + " líneas. Al límite: revisa qué se puede mover a la skill.");
      if (n < 5)  return aviso(n + " líneas. Probablemente le falta la frontera o las herramientas.");
      return ok(n + " líneas."); } },

    { eje: "ubicacion", peso: 5, n: "Ningún número vive en el prompt", f: function (d) {
      var h = umbrales(d);
      return h.length ? falla("Hay " + h.length + " umbral(es) aquí. En un prompt es más tentador que nunca, y sigue yendo en gates.yaml.", h)
        : ok("Sin umbrales."); } },
    { eje: "ubicacion", peso: 5, n: "Sin procedimiento incrustado", f: function (d) {
      var pasos = (d.cuerpo.match(/^\s*\d+\.\s+\S/gm) || []).length;
      var secs = (d.cuerpo.match(/^#{2,3}\s*(paso|step)/gim) || []).length;
      if (secs || pasos >= 4 || d.bloques >= 2) {
        return falla("Trae el procedimiento dentro (" + (pasos || secs) + " pasos, " + d.bloques + " bloques). Va en la skill: aquí se pierde para los otros equipos y para el versionado del catálogo.");
      }
      return ok("El procedimiento no está aquí."); } },
    { eje: "ubicacion", peso: 3, n: "Sin contexto de proyecto", f: function (d) {
      var m = d.prosaTexto.match(/\b(nuestr[oa]s?|el repositorio [\w\-\/]+|la arquitectura de|en producci[óo]n usamos|el equipo de [A-ZÁÉÍÓÚ]\w+)\b/i);
      return m ? aviso("Aparece «" + m[0] + "». El contexto del proyecto va en CLAUDE.md; aquí se duplica en cada rol y se desincroniza.")
        : ok("Sin contexto de proyecto."); } },
    { eje: "ubicacion", peso: 2, n: "Nada después de la tarea", f: function (d) {
      var c = cola(d);
      return c ? aviso("Cierra con un recordatorio: «" + c.slice(0, 70) + "». Si la restricción es crítica, va arriba.")
        : ok("Sin coletilla."); } },

    { eje: "seguridad", peso: 4, n: "Sin credenciales", f: function (d) {
      return credencial(d) ? falla("Parece haber una credencial. Los límites van en la infraestructura, no en el texto.") : ok("Sin secretos."); } },
    { eje: "seguridad", peso: 3, n: "No confía el aislamiento a la redacción", f: function (d) {
      var pide = /\bno\s+(toques|accedas|despliegues|leas)\b[^.\n]{0,60}(producci[óo]n|handoffs?|credencial)/i.test(d.cuerpo);
      if (!pide) return ok("No delega aislamiento al texto.");
      return d.fm.tools
        ? aviso("Pide una restricción en prosa y además declara tools:. La línea tools: es la que manda; asegúrate de que la respalde.")
        : falla("Confía una restricción crítica a la redacción, sin declarar tools:. Si el proceso tiene la credencial, no hay instrucción que la detenga."); } }
  ];

  var EJES = {
    disparo:       { et: "disparo",       q: "Si el agente la carga cuando debe." },
    procedimiento: { et: "procedimiento", q: "Si es seguible sin adivinar." },
    identidad:     { et: "identidad",     q: "Si el rol sabe quién es." },
    frontera:      { et: "frontera",      q: "Si sabe dónde termina." },
    ubicacion:     { et: "ubicación",     q: "Si cada línea está en la capa que le toca." },
    seguridad:     { et: "seguridad",     q: "Si es defendible ante revisión." }
  };
  var PESOS = {
    skill:  { disparo: 0.25, procedimiento: 0.25, ubicacion: 0.35, seguridad: 0.15 },
    prompt: { identidad: 0.25, frontera: 0.25, ubicacion: 0.35, seguridad: 0.15 }
  };
  var VALOR = { ok: 1, aviso: 0.5, falla: 0 };

  function analizar(texto, forzado, arch) {
    var d = parsear(texto);
    var det = detectar(d, arch);
    var tipo = forzado || det.tipo;
    var reglas = (tipo === "prompt" ? R_PROMPT : R_SKILL).map(function (r) {
      var o;
      try { o = r.f(d); } catch (e) { o = aviso("No se pudo evaluar."); }
      return { eje: r.eje, peso: r.peso, nombre: r.n, estado: o.estado, detalle: o.detalle, lineas: o.lineas };
    });
    var ejes = {}, pesos = PESOS[tipo];
    Object.keys(pesos).forEach(function (k) {
      var rs = reglas.filter(function (r) { return r.eje === k; });
      var pos = rs.reduce(function (a, r) { return a + r.peso; }, 0);
      var got = rs.reduce(function (a, r) { return a + r.peso * VALOR[r.estado]; }, 0);
      ejes[k] = pos ? got / pos : 0;
    });
    var total = Object.keys(pesos).reduce(function (a, k) { return a + pesos[k] * ejes[k]; }, 0);
    return { tipo: tipo, detectado: det, reglas: reglas, ejes: ejes, total: total,
             sinFrontmatter: !d.fm.name && !d.fm.description };
  }

  function letra(t) { return t >= 0.9 ? "A" : t >= 0.8 ? "B" : t >= 0.68 ? "C" : t >= 0.55 ? "D" : "F"; }

  // ── render ──────────────────────────────────────────────────────────────
  var $ = function (s) { return document.querySelector(s); };
  var st = { texto: null, archivo: null, tipo: null };

  function pintar(a) {
    $("#an-result").hidden = false;
    $("#an-file").textContent = st.archivo;
    $("#an-grade").textContent = letra(a.total);
    $("#an-score").textContent = Math.round(a.total * 100);
    $("#an-grade").style.color = a.total >= 0.8 ? "var(--healthy)" : a.total >= 0.55 ? "var(--signal)" : "var(--burn)";

    $("#an-type").textContent = a.tipo === "prompt" ? "prompt de rol" : "skill";
    $("#an-conf").textContent = st.tipo ? "elegido por ti" : "detección " + a.detectado.confianza;
    $("#an-swap").textContent = a.tipo === "prompt" ? "analizar como skill" : "analizar como prompt de rol";

    var ejesEl = $("#an-axes"); ejesEl.innerHTML = "";
    Object.keys(PESOS[a.tipo]).forEach(function (k) {
      var v = a.ejes[k];
      var li = document.createElement("li");
      li.className = "signal-row";
      li.innerHTML = '<span class="signal-name"></span><span class="signal-bar"><span class="signal-val"></span></span><span class="signal-num"></span>';
      li.querySelector(".signal-name").textContent = EJES[k].et;
      li.querySelector(".signal-name").title = EJES[k].q;
      li.querySelector(".signal-num").textContent = Math.round(v * 100) + "%";
      var b = li.querySelector(".signal-val");
      b.classList.add(v >= 0.75 ? "ok" : "low");
      b.style.width = Math.round(v * 100) + "%";
      ejesEl.appendChild(li);
    });

    var f = a.reglas.filter(function (r) { return r.estado === "falla"; }).length;
    var av = a.reglas.filter(function (r) { return r.estado === "aviso"; }).length;
    $("#an-tally").textContent = f + " fallas · " + av + " avisos · " + (a.reglas.length - f - av) + " en regla";

    var lista = $("#an-rules"); lista.innerHTML = "";
    var orden = { falla: 0, aviso: 1, ok: 2 };
    a.reglas.slice().sort(function (x, y) { return orden[x.estado] - orden[y.estado] || y.peso - x.peso; })
      .forEach(function (r) {
        var li = document.createElement("li");
        li.className = "rule rule-" + r.estado;
        li.innerHTML = '<span class="rule-dot"></span><div><p class="rule-n"></p><p class="rule-d"></p><ul class="rule-lines"></ul></div>';
        li.querySelector(".rule-n").textContent = r.nombre;
        li.querySelector(".rule-d").textContent = r.detalle;
        var ul = li.querySelector(".rule-lines");
        if (r.lineas && r.lineas.length) {
          r.lineas.forEach(function (h) {
            var x = document.createElement("li");
            x.innerHTML = '<span class="ln"></span><span class="lt"></span>';
            x.querySelector(".ln").textContent = "L" + h.n;
            x.querySelector(".lt").textContent = h.texto;
            ul.appendChild(x);
          });
        } else { ul.remove(); }
        lista.appendChild(li);
      });

    $("#an-warn").hidden = !a.sinFrontmatter;
    if (a.sinFrontmatter) $("#an-warn").textContent = "Este archivo no tiene frontmatter YAML. Sin él ningún harness lo carga.";
    $("#an-result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function correr(texto, archivo) {
    st.texto = texto; st.archivo = archivo; st.tipo = null;
    pintar(analizar(texto, null, archivo));
  }

  function leer(file) {
    if (file.size > 400 * 1024) {
      $("#an-warn").hidden = false;
      $("#an-warn").textContent = "El archivo pesa más de 400 KB. ¿Seguro que es un SKILL.md o un prompt de rol?";
      return;
    }
    var fr = new FileReader();
    fr.onload = function () { correr(String(fr.result), file.name); };
    fr.onerror = function () {
      $("#an-warn").hidden = false;
      $("#an-warn").textContent = "No se pudo leer el archivo. Pega el contenido en su lugar.";
    };
    fr.readAsText(file);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var zona = $("#an-drop"), input = $("#an-input"), ta = $("#an-paste");
    if (!zona) return;

    zona.addEventListener("click", function () { input.click(); });
    zona.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", function () { if (input.files[0]) leer(input.files[0]); });

    ["dragenter", "dragover"].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove("over"); });
    });
    zona.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) leer(e.dataTransfer.files[0]); });

    $("#an-run").addEventListener("click", function () {
      var t = ta.value.trim();
      if (!t) {
        $("#an-warn").hidden = false;
        $("#an-warn").textContent = "Pega el contenido de un SKILL.md o de un prompt de rol.";
        return;
      }
      correr(t, "(pegado)");
    });

    $("#an-swap").addEventListener("click", function () {
      if (!st.texto) return;
      var actual = st.tipo || analizar(st.texto, null, st.archivo).tipo;
      st.tipo = actual === "prompt" ? "skill" : "prompt";
      pintar(analizar(st.texto, st.tipo, st.archivo));
    });
  });
})();
