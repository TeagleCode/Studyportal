(function () {
  const container = document.getElementById('bgSymbols');
  if (!container) return;

  const symbols = [
    '📚','📖','📝','✏️','📐','📏','📓','📔','📒','📕','📗','📘','🎓',
    '🔬','🧪','⚗️','🔭','🧬','🧲','⚡','💡','🌡️','🏫','🖋️','🧮',
    '⚛️','🔋','🌍','🗂️',
    'α','β','γ','δ','ε','ζ','η','θ','λ','μ','ν','ξ','π','ρ','σ','τ','φ','ψ','ω','Δ','Σ','Ω','Φ','Ψ',
    '∑','√','∞','∫','∂','∇','÷','×','≠','≤','≥','±','²','³','∈','∉','⊂','∩','∪','∝','∴','∵',
    'E=mc²','F=ma','a²+b²=c²','v=λf','PV=nRT','W=Fd','ρ=m/V',
    'P=F/A','v=d/t','F=kx','I=V/R','E=hf','p=mv',
    'H₂O','CO₂','NaCl','O₂','H₂','CH₄','ℏ','∮','⊕','℃','∡',
  ];

  const placed = [];
  const W = window.innerWidth;
  const H = window.innerHeight;

  function overlaps(x, y, md) {
    return placed.some(p => Math.hypot(p.x - x, p.y - y) < Math.max(md, p.md));
  }

  for (let i = 0; i < 70; i++) {
    const sym = symbols[Math.floor(Math.random() * symbols.length)];
    const md  = Math.max(150, sym.length * 38);
    let x, y, tries = 0;
    do { x = Math.random() * W; y = Math.random() * H; tries++; }
    while (overlaps(x, y, md) && tries < 150);
    if (tries >= 150) continue;

    placed.push({ x, y, md });
    const el = document.createElement('span');
    el.textContent  = sym;
    el.style.left   = x + 'px';
    el.style.top    = y + 'px';
    el.style.fontSize  = (1.2 + Math.random() * 2.2).toFixed(1) + 'rem';
    el.style.opacity   = (0.04 + Math.random() * 0.1).toFixed(2);
    el.style.transform = `rotate(${Math.round(Math.random() * 60 - 30)}deg)`;
    container.appendChild(el);
  }
})();
