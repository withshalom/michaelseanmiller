// Nav scroll behavior
const nav = document.getElementById('mainNav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

// Flyer lightbox — lets phones enlarge the flyer to scan the QR code
const lb = document.getElementById('lightbox');
const lbImg = lb.querySelector('img');

function openLightbox(img) {
  lbImg.src = img.currentSrc || img.src;
  lbImg.alt = img.alt;
  lb.classList.add('open');
  lb.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  lb.classList.remove('open');
  lb.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  lbImg.removeAttribute('src');
}

document.querySelectorAll('.js-zoom').forEach(el => {
  const img = el.querySelector('img');
  if (!img) return;
  el.addEventListener('click', () => openLightbox(img));
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(img); }
  });
});

lb.addEventListener('click', closeLightbox);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && lb.classList.contains('open')) closeLightbox();
});
