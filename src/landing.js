import { h } from './dom.js';
import './landing.css';

/** Public marketing page. Media URLs below are bundled assets already shipped by 12toons. */
const scrollToSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const navLink = (label, id) => h('a', { href: '#' + id, onclick: (e) => { e.preventDefault(); scrollToSection(id); } }, label);
const eyebrow = (text) => h('span', { class: 'lp-eyebrow' }, text);
const sectionTitle = (ey, title, description) => h('div', { class: 'lp-heading' }, eyebrow(ey), h('h2', {}, title), h('p', {}, description));

const FEATURES = [
  { path: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM6 11a6 6 0 0 0 12 0M12 17v4', title: 'Characters that talk', body: 'Add your voice and watch them come alive.' },
  { path: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z', title: 'Scenes, directed for you', body: 'Turn your script into a polished scene.' },
  { path: 'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3.5 20a6.5 6.5 0 0 1 10-5.2M14.5 21l.7-3 5.3-5.3 2.3 2.3-5.3 5.3-3 .7Z', title: 'Characters that are yours', body: 'Create a look nobody else has.' },
  { path: 'M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', title: 'Cinematic feel', body: 'Give every moment the energy of a film.' },
  { path: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5ZM4 16l5-5 4 4 3-3 4 4M9 9a1 1 0 1 0 0-.01', title: 'Any world you imagine', body: 'Set your story anywhere you like.' },
  { path: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14', title: 'Ready to share', body: 'Crisp videos for YouTube, Reels and more.' }
];

const USE_CASES = [
  { icon: '▶', title: 'YouTube cartoons', body: 'Turn a character-based script and voiceover into an edited cartoon scene.' },
  { icon: '💬', title: 'Animated conversations', body: 'Direct two-character dialogue with speaker lip-sync and listener reactions.' },
  { icon: '📚', title: 'Explainer videos', body: 'Combine spoken narration, custom backgrounds and timed character actions.' },
  { icon: '🎨', title: 'Original characters', body: 'Build or customise reusable 2D characters before they enter your video.' }
];


const HERO_PATHS = { characters: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0', voice: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM6 11a6 6 0 0 0 12 0M12 17v4', timeline: 'M3 5h18v14H3zM3 10h18M8 5v14M16 5v14', export: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14' };
/** the same shortcuts as the app menu, so they are also on the page itself */
const QUICK = [
  ['#/toons', 'Animator Studio', 'M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM16 10.5l5-3v9l-5-3'],
  ['#/characters', 'Character Editor', 'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3.5 20a6.5 6.5 0 0 1 10-5.2M14.5 21l.7-3 5.3-5.3 2.3 2.3-5.3 5.3-3 .7Z'],
  ['#/credits', 'Coins', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v10M9.5 9.5h4a1.7 1.7 0 0 1 0 3.5h-3a1.7 1.7 0 0 0 0 3.5h4'],
  ['#/affiliate-dashboard', 'Earn with us', 'M4 17l6-6 4 4 6-10m-6 0h6v6'],
];
function quickIcon(d) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path); return svg;
}
/** a vertical line of icons on the right side of the hero; the button at the top opens it to show every name */
function quickDock() {
  const toggle = h('button', { type: 'button', class: 'lp-dock-item lp-dock-toggle', 'aria-expanded': 'false', 'aria-label': 'Show all shortcuts', onclick: () => { const open = dock.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Close the shortcut list' : 'Show all shortcuts'); } });
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); arrow.setAttribute('viewBox', '0 0 24 24'); arrow.setAttribute('aria-hidden', 'true');
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path'); arrowPath.setAttribute('d', 'M4 6h16M4 12h16M4 18h16'); arrow.append(arrowPath);
  const label = h('span', {}, 'Menu');
  toggle.append(arrow, label);
  const dock = h('aside', { class: 'lp-dock', 'aria-label': 'Quick links' }, toggle, ...QUICK.map(([href, name, path]) => h('a', { href, class: 'lp-dock-item', title: name }, quickIcon(path), h('span', {}, name))));
  const close = () => { dock.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', 'Show all shortcuts'); };
  document.addEventListener('pointerdown', (e) => { if (!dock.isConnected) return; if (dock.classList.contains('open') && !dock.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dock.isConnected) close(); });
  return dock;
}
/** sections slide in as they scroll into view; nothing is hidden if the browser cannot observe or the person prefers less motion */
function setupReveal(root) {
  if (typeof IntersectionObserver === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.classList.add('lp-reveal-ready');
  const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
  const groups = new Map();
  for (const el of root.querySelectorAll('.lp-feature-row,.lp-how-card,.lp-heading,.lp-faq details,.lp-final-cta')) {
    const n = groups.get(el.parentElement) || 0; groups.set(el.parentElement, n + 1);
    el.style.setProperty('--i', String(Math.min(n, 6))); io.observe(el);
  }
}
function menuIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M4 6h16M4 12h16M4 18h16'); svg.append(path); return svg;
}
function heroIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', HERO_PATHS[name]); svg.append(path);
  return h('i', { class: 'lp-hero-icon' }, svg);
}

const FAQ = [
  ['What is 12toons?', '12toons is a browser-based studio for making 2D animated videos. Pick a character, add your voice recordings or work silently, direct the scenes on a timeline and export a finished video.'],
  ['Do I need to draw to make an animation?', 'No. Choose a ready-made character and animation clips, or build and customise your own character in Character Editor.'],
  ['Can I use my own voice recordings?', 'Yes. Add audio files one by one, or upload a ZIP of numbered voice lines, and assign each voice to a character. Lip-sync is added automatically.'],
  ['Can I make a video without any audio?', 'Yes. You can build a silent scene with character motion, backgrounds and camera moves.'],
  ['Do I need an account?', 'You can look around this page without one. To open the studios and save your work, sign in with your Google account, which takes a few seconds.'],
  ['Is my work saved?', 'Yes. Projects save automatically while you edit, to this device and to your account, so you can pick them up again after signing in on another device. You should still keep a copy of your finished videos and source files.'],
  ['Can I sign in on more than one device?', 'You can sign in on any device, but only one device can be signed in to an account at a time. If you sign in somewhere new, you will be asked to confirm, and the other device is signed out.'],
  ['What video formats can I export?', 'You can export WebM or MP4. Free accounts can export videos up to 2 minutes long. Buying Coins raises the limit to 10 minutes per export.'],
  ['What are Coins?', 'Coins are optional one-time purchases that unlock longer exports. You can see your balance and payment history on the Coins page. Payments are processed securely by Razorpay.'],
  ['Does 12toons use AI?', 'AI is optional. You can direct every scene yourself, or use the AI tools to get suggestions for who appears, which animation plays and how the camera frames the scene. Review and edit every suggestion before you use it.'],
  ['Who pays for the AI tools?', 'The AI tools run on your own OpenRouter API key, so OpenRouter may charge your account for the model use. The key is stored only in this browser. Do not save it on a shared or public device.'],
  ['What is sent to the AI provider?', 'When you use an AI tool, the dialogue and the selected character and animation details are sent from your browser to OpenRouter. Transcription sends the audio line you choose. Nothing is sent unless you start an AI request.'],
  ['Can I use my own characters, images and audio?', 'Yes, as long as you own them or have permission to use them. You are responsible for the files you upload.'],
  ['Can I use the built-in characters in commercial work?', 'The Website Licence page explains what you can do with the built-in characters and animations. Rights can differ between assets, so please read it before you publish a video.'],
  ['What if I clear my browser data or switch devices?', 'Projects saved to your account come back when you sign in again. Anything that only exists in this browser, such as a draft that has not synced yet, can be lost when browser data is cleared, so wait for the save indicator before you close the studio.'],
  ['How do I get help?', 'Use the Chat button at the bottom of the page to message our team. Tell us which page you were on and which browser you use. Never send passwords or API keys.']
];


/** the first questions are shown, the rest open with one tap, so the page stays short */
function faqList() {
  const row = ([question, answer]) => h('details', {}, h('summary', {}, question), h('p', {}, answer));
  const rest = h('div', { class: 'lp-faq-more', hidden: true }, FAQ.slice(6).map(row));
  const more = h('button', { type: 'button', class: 'lp-button lp-button-outline lp-faq-toggle', onclick: () => { rest.hidden = !rest.hidden; more.textContent = rest.hidden ? `Show ${FAQ.length - 6} more questions` : 'Show fewer questions'; } }, `Show ${FAQ.length - 6} more questions`);
  return h('div', { class: 'lp-faq' }, FAQ.slice(0, 6).map(row), rest, more);
}

function button(label, fn, style = 'primary', royal = false) {
  return h('button', { type: 'button', class: `lp-button ${style === 'primary' ? 'lp-button-primary' : 'lp-button-outline'} ${royal ? 'lp-button-royal' : ''}`, onclick: fn }, label);
}



export function landingView({ user, cta, profileMenu, logo }) {

  const pricingLink = h('a', { href: '#/credits', onclick: (e) => { e.preventDefault(); window.location.hash = '#/credits'; } }, 'Pricing');
  const brand = logo(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  const primaryCta = (label) => h('span', { class: 'lp-button-content' }, h('img', { src: '/images/royal-crown-emblem.png', alt: '', width: '38', height: '38', loading: 'lazy' }), h('span', {}, label));
  const leftNav = h('nav', { class: 'lp-nav lp-nav-left', 'aria-label': 'Main navigation' },
    navLink('Home', 'top'), navLink('Features', 'features'));
  const rightNav = h('nav', { class: 'lp-nav lp-nav-right', 'aria-label': 'More navigation' },
    navLink('How it works', 'how'), pricingLink);
  const mobileNav = h('nav', { class: 'lp-mobile-nav', 'aria-label': 'Mobile navigation' },
    navLink('Home', 'top'), navLink('Features', 'features'), navLink('How it works', 'how'),
    h('a', { href: '#/credits', onclick: (e) => { e.preventDefault(); window.location.hash = '#/credits'; } }, 'Pricing'), navLink('FAQ', 'faq'));

  const burger = h('button', { type: 'button', class: 'hdr-burger', 'aria-label': 'Open menu', 'aria-expanded': 'false', onclick: () => { const open = mobileNav.classList.toggle('open'); burger.setAttribute('aria-expanded', String(open)); } }, menuIcon());
  mobileNav.addEventListener('click', (e) => { if (e.target.closest('a')) { mobileNav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); } });
  const page = h('div', { class: 'sh lp' },
    h('header', { class: 'sh-bar lp-header' },
      burger,
      leftNav,
      h('div', { class: 'lp-brand-crest' }, brand),
      h('div', { class: 'lp-header-right' }, rightNav,
        user ? profileMenu() : button('Open Studio →', cta, 'primary'))
    ),
    mobileNav,
    h('main', {},
      h('section', { class: 'lp-hero', id: 'top' },
        h('div', { class: 'lp-hero-copy' },
          h('img', { class: 'lp-hero-logo', src: '/images/12toons-logo.png', alt: '12toons logo', width: '150', height: '150' }),
          eyebrow('♛  AI-powered 2D animation studio'),
          h('h1', {}, 'Make your stories ', h('span', { class: 'lp-accent' }, 'move.')),
          h('p', { class: 'lp-hero-lead' }, 'Turn your script and your voice into a finished animated video. No drawing, no software to install.'),
          h('div', { class: 'lp-actions' }, button(primaryCta('Open my studio  →'), cta, 'primary', true), button('▶  Explore the studio', () => scrollToSection('features'), 'outline')),
          h('div', { class: 'lp-hero-foot' },
            h('span', {}, heroIcon('characters'), h('strong', {}, 'AI Characters'), h('small', {}, 'Create & customise')),
            h('span', {}, heroIcon('voice'), h('strong', {}, 'Voice & Lip-sync'), h('small', {}, 'Natural dialogue')),
            h('span', {}, heroIcon('timeline'), h('strong', {}, 'Editable Timeline'), h('small', {}, 'Direct every scene')),
            h('span', {}, heroIcon('export'), h('strong', {}, 'Export Anywhere'), h('small', {}, 'Video from browser')))
        ),
        quickDock()
      ),
      h('section', { id: 'features', class: 'lp-section lp-section-soft' },
        sectionTitle('All in one workspace', 'Create, direct and export in one place', 'Everything you need to turn an idea into a finished animation.'),
        h('div', { class: 'lp-feature-list' }, FEATURES.map(f => h('article', { class: 'lp-feature-row' },
          h('span', { class: 'lp-feature-icon', 'aria-hidden': 'true' }, quickIcon(f.path)),
          h('div', {}, h('h3', {}, f.title), h('p', {}, f.body))
        )))
      ),
      h('section', { id: 'how', class: 'lp-section lp-section-soft' },
        sectionTitle('A simple workflow', 'From idea to animated video', 'Start with a script, audio recording or a blank scene. Make the rest your own.'),
        h('div', { class: 'lp-how-grid' }, [
          ['01', 'Choose your cast', 'Select an available character or create and customise one in Character Editor.'],
          ['02', 'Build and animate', 'Add your voice, pick the moves, and shape every scene your way.'],
          ['03', 'Preview and export', 'Watch it come together, then export a video that is ready to share.']
        ].map(([number, title, body]) => h('article', { class: 'lp-how-card' }, h('span', {}, number), h('h3', {}, title), h('p', {}, body))))
      ),
      h('section', { id: 'faq', class: 'lp-section lp-section-soft' },
        sectionTitle('Good to know', 'Frequently asked questions', 'A few answers before you start creating.'),
        faqList()
      ),
      h('section', { class: 'lp-final-cta' }, eyebrow('Ready to create?'), h('h2', {}, 'Your next story starts here.'), h('p', {}, 'Bring characters and dialogue together with 12toons.'), button(user ? 'Open my studio →' : 'Get started with 12toons →', cta))
    ),
    h('footer', { class: 'lp-footer' }, h('a', { href: '/#/', style: 'color:inherit;text-decoration:none', 'aria-label': '12toons home' }, h('strong', {}, '12toons')), h('span', {}, 'Browser-based 2D animation & character creation'),
      h('nav', { class: 'lp-legal-links', 'aria-label': 'Legal information' },
        h('a', { href: '/#/terms' }, 'Terms of Use'), h('a', { href: '/#/website-license' }, 'Website Licence'), h('a', { href: '/#/affiliates' }, 'Affiliate Partners'), h('a', { href: '/#/tester' }, 'Tester access')),
      h('small', {}, '© 2026 12toons. All rights reserved.'))
  );
  setupReveal(page);
  return page;
}

