import { h } from './dom.js';
import './landing.css';
import { goldCoin } from './coin.js';

/** Public marketing page. Media URLs below are bundled assets already shipped by 12toons. */
const scrollToSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const navLink = (label, id) => h('a', { href: '#' + id, onclick: (e) => { e.preventDefault(); scrollToSection(id); } }, label);
const eyebrow = (text) => h('span', { class: 'lp-eyebrow' }, text);
const sectionTitle = (ey, title, description) => h('div', { class: 'lp-heading' }, eyebrow(ey), h('h2', {}, title), h('p', {}, description));

const FEATURES = [
  { icon: '🎙', title: 'Audio-driven lip-sync', body: 'Upload recorded dialogue, match each speaker to a character, and make conversations move with your voice.', detail: 'Built for talking characters, not just silent motion clips.' },
  { icon: '✨', title: 'AI scene direction', body: 'Let AI propose who appears, which gestures to use, and how to frame the camera for each line.', detail: 'Adjust every suggestion on your timeline.' },
  { icon: '🎭', title: '2D Character Studio', body: 'Edit character outfits, facial features, layers and colours or import your own DragonBones characters.', detail: 'Design once, use your character in your scenes.' },
  { icon: '🎥', title: 'Camera & motion keyframes', body: 'Plan close-ups, wide shots, character positions and camera moves on editable keyframes.', detail: 'Keep control of pacing and composition.' },
  { icon: '🖼', title: 'Backgrounds and scenes', body: 'Add your own images, place characters on the stage, and build a scene around your script.', detail: 'Works for dialogue and visual storytelling.' },
  { icon: '🎞', title: 'WebM & MP4 export', body: 'Preview your work and export videos in multiple sizes and aspect ratios, including up to 4K.', detail: 'Finish your work in the same browser studio.' }
];

const USE_CASES = [
  { icon: '▶', title: 'YouTube cartoons', body: 'Turn a character-based script and voiceover into an edited cartoon scene.' },
  { icon: '💬', title: 'Animated conversations', body: 'Direct two-character dialogue with speaker lip-sync and listener reactions.' },
  { icon: '📚', title: 'Explainer videos', body: 'Combine spoken narration, custom backgrounds and timed character actions.' },
  { icon: '🎨', title: 'Original characters', body: 'Build or customise reusable 2D characters before they enter your video.' }
];

const FAQ = [
  ['What is 12toons?', '12toons is a browser-based studio for making 2D animated videos. Pick a character, add your voice recordings or work silently, direct the scenes on a timeline and export a finished video.'],
  ['Do I need to draw to make an animation?', 'No. Choose a ready-made character and animation clips, or build and customise your own character in Character Studio.'],
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

  return h('div', { class: 'sh lp' },
    h('header', { class: 'sh-bar lp-header' },
      leftNav,
      h('div', { class: 'lp-brand-crest' }, brand),
      h('div', { class: 'lp-header-right' }, rightNav,
        user ? profileMenu() : button('Open Studio →', cta, 'primary'))
    ),
    mobileNav,
    h('main', {},
      h('section', { class: 'lp-hero', id: 'top' },
        h('div', { class: 'lp-hero-copy' },
          eyebrow('♛  AI-powered 2D animation studio'),
          h('h1', {}, 'Make your stories ', h('span', { class: 'lp-accent' }, 'move.')),
          h('p', { class: 'lp-hero-lead' }, 'Create 2D animated videos online using characters, voice recordings and an editable timeline. Add lip-sync, direct scenes with AI, and export your animation from your browser.'),
          h('div', { class: 'lp-actions' }, button(primaryCta('Open my studio  →'), cta, 'primary', true), button('▶  Explore the studio', () => scrollToSection('features'), 'outline')),
          h('div', { class: 'lp-hero-foot' },
            h('span', {}, goldCoin(56, { emblem: 'characters' }), h('strong', {}, 'AI Characters'), h('small', {}, 'Create & customise')),
            h('span', {}, goldCoin(56, { emblem: 'voice' }), h('strong', {}, 'Voice & Lip-sync'), h('small', {}, 'Natural dialogue')),
            h('span', {}, goldCoin(56, { emblem: 'timeline' }), h('strong', {}, 'Editable Timeline'), h('small', {}, 'Direct every scene')),
            h('span', {}, goldCoin(56, { emblem: 'export' }), h('strong', {}, 'Export Anywhere'), h('small', {}, 'Video from browser')))
        )
      ),
      h('section', { class: 'lp-coin-section', 'aria-labelledby': 'lp-coins-title' },
        h('div', { class: 'lp-coin-offer' },
          h('div', { class: 'lp-coin-display', 'aria-hidden': 'true' }, goldCoin(112)),
          h('div', { class: 'lp-coin-copy' }, eyebrow('THE ROYAL TREASURY'),
            h('h2', { id: 'lp-coins-title' }, 'More Coins. More possibilities.'),
            h('p', {}, 'Find your Coin pack and keep creating. One-time purchases, with your balance and payment history in one place.')),
          h('a', { class: 'lp-button lp-button-primary', href: '#/credits' }, 'Buy Coins  →'))),
      h('section', { id: 'features', class: 'lp-section lp-section-soft' },
        sectionTitle('All in one workspace', 'Create, direct and export in one place', 'From dialogue to character motion, 12toons gives you tools to make and fine-tune every scene.'),
        h('div', { class: 'lp-feature-grid' }, FEATURES.map(f => h('article', { class: 'lp-feature-card' },
          h('span', { class: 'lp-feature-icon', 'aria-hidden': 'true' }, f.icon),
          h('h3', {}, f.title), h('p', {}, f.body), h('small', {}, f.detail)
        )))
      ),
      h('section', { id: 'how', class: 'lp-section lp-section-soft' },
        sectionTitle('A simple workflow', 'From idea to animated video', 'Start with a script, audio recording or a blank scene. Make the rest your own.'),
        h('div', { class: 'lp-how-grid' }, [
          ['01', 'Choose your cast', 'Select an available character or create and customise one in Character Studio.'],
          ['02', 'Build and animate', 'Add voice recordings if you have them, arrange animation clips, and fine-tune scenes and cameras.'],
          ['03', 'Preview and export', 'Review your animation and export a WebM or MP4 video from the browser.']
        ].map(([number, title, body]) => h('article', { class: 'lp-how-card' }, h('span', {}, number), h('h3', {}, title), h('p', {}, body))))
      ),
      h('section', { id: 'use-cases', class: 'lp-section' },
        sectionTitle('Made for creators', 'What can you create with 12toons?', 'Make character-led stories, conversations and videos with creative control from start to finish.'),
        h('div', { class: 'lp-use-grid' }, USE_CASES.map(u => h('article', { class: 'lp-use-card' }, h('span', { 'aria-hidden': 'true' }, u.icon), h('h3', {}, u.title), h('p', {}, u.body))))
      ),
      h('section', { class: 'lp-section lp-tools-section' },
        h('div', { class: 'lp-tools-copy' }, eyebrow('Two creative workspaces'), h('h2', {}, 'Everything starts with your character'), h('p', {}, 'Make characters in Character Studio, then bring them to life with dialogue, animation clips, scene direction and timeline editing.'),
          h('div', { class: 'lp-tools-actions' }, button('Explore both tools →', cta))),
        h('div', { class: 'lp-tools-cards' },
          h('article', {}, h('span', {}, '🎭'), h('h3', {}, 'Character Studio'), h('p', {}, 'Edit layered characters, outfits, colours, facial features and poses.')),
          h('article', {}, h('span', {}, '🎬'), h('h3', {}, 'Animation Studio'), h('p', {}, 'Set up scenes, direct animation and cameras, then export your video.'))
        )
      ),
      h('section', { id: 'faq', class: 'lp-section lp-section-soft' },
        sectionTitle('Good to know', 'Frequently asked questions', 'A few answers before you start creating.'),
        h('div', { class: 'lp-faq' }, FAQ.map(([question, answer]) => h('details', {}, h('summary', {}, question), h('p', {}, answer))))
      ),
      h('section', { class: 'lp-final-cta' }, eyebrow('Ready to create?'), h('h2', {}, 'Your next story starts here.'), h('p', {}, 'Bring characters and dialogue together with 12toons.'), button(user ? 'Open my studio →' : 'Get started with 12toons →', cta))
    ),
    h('footer', { class: 'lp-footer' }, h('a', { href: '/#/', style: 'color:inherit;text-decoration:none', 'aria-label': '12toons home' }, h('strong', {}, '12toons')), h('span', {}, 'Browser-based 2D animation & character creation'),
      h('nav', { class: 'lp-legal-links', 'aria-label': 'Legal information' },
        h('a', { href: '/#/terms' }, 'Terms of Use'), h('a', { href: '/#/website-license' }, 'Website Licence'), h('a', { href: '/#/affiliates' }, 'Affiliate Partners'), h('a', { href: '/#/tester' }, 'Tester access')),
      h('small', {}, '© 2026 12toons. All rights reserved.'))
  );
}

