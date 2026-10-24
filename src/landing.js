import { h } from './dom.js';
import './landing.css';

/** Public marketing page. Media URLs below are bundled assets already shipped by 12toons. */
const pose = (name) => '/autodraft/pose/' + name + '.webp';
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
  ['Can I make an animated video without drawing?', 'Yes. You can choose from available characters and animation clips, or bring your own compatible character files.'],
  ['Can I animate my own voice recordings?', 'Yes. Add individual audio files or a ZIP containing numbered voice lines, and assign each voice to a character.'],
  ['Do I need audio to use the Animation Studio?', 'No. You can build a silent scene and add character motion, backgrounds and camera moves without uploading audio.'],
  ['What does AI scene direction do?', 'It can suggest who appears, animation choices and camera framing from the dialogue context you provide. Review and edit every suggestion before using it.'],
  ['Does AI direction work automatically?', 'No. AI features are optional. You can direct scenes manually, or use the AI tools with your own OpenRouter API key.'],
  ['What information is sent when I use the AI tools?', 'A direction request sends the dialogue context and selected character and animation information to OpenRouter. Transcription sends the audio line you selected. These requests go directly from your browser to OpenRouter.'],
  ['Will OpenRouter charge me?', 'OpenRouter may charge your account for model use. Your OpenRouter key and provider account are separate from your 12toons account; check the provider’s pricing and terms before sending a request.'],
  ['Where is my OpenRouter key stored?', 'The key is stored in this browser’s local storage and sent to OpenRouter when you use an AI feature. Do not save it on a shared or public device.'],
  ['What formats can I export?', 'The studio supports WebM and MP4 video exports. Available output sizes and aspect ratios depend on the project and the browser.'],
  ['Where are projects saved?', 'Projects are saved in this browser on your device. If account cloud storage is configured, project data and files can also sync to the service’s Firebase and R2 storage.'],
  ['Will my project sync to the cloud automatically?', 'Cloud sync depends on the service being configured and your account being signed in. The app shows its cloud status in the studio; keep a separate copy of important exports and source files.'],
  ['What happens if I clear browser data or change devices?', 'Local drafts may be removed when browser storage is cleared or the device is lost. Cloud-synced projects may be restored after signing in where cloud storage is available. Export important work regularly.'],
  ['Can I use my own characters, images and audio?', 'Yes, if you have the rights and permissions needed to use those files. You are responsible for the content you upload and for any people or rights represented in it.'],
  ['Can I use built-in characters and animations in commercial work?', 'The Website Licence page explains the current limits for bundled artwork and media. Rights may differ by asset, so check the relevant notice before distributing a project.'],
  ['Do I need a 12toons account?', 'Sign-in is required to open the creative studios and save work to an account. The public landing page and these information pages can be viewed without signing in when maintenance mode is off.'],
  ['Why can’t I open the studios right now?', 'The service may be in maintenance mode, unavailable, or your account may not have access. Staff sign-in is restricted to Google accounts enabled by the service administrator.'],
  ['How do I report a problem?', 'Use the support channel through which you received access to 12toons, and include the page and browser where the issue occurred. Do not send passwords, API keys, or private project files unless requested through a trusted channel.']
];

const characterPreviews = [
  { title: 'Neha', desc: 'Layered character template', image: pose('neha-front-side') },
  { title: 'My Baby', desc: 'Editable outfits and colours', image: pose('mybaby-front-side') },
  { title: 'Village Boy', desc: 'Character with its own animations', image: pose('villageboy-front-side') }
];

function button(label, fn, style = 'primary', royal = false) {
  return h('button', { type: 'button', class: `lp-button ${style === 'primary' ? 'lp-button-primary' : 'lp-button-outline'} ${royal ? 'lp-button-royal' : ''}`, onclick: fn }, label);
}

function editorPreview() {
  return h('div', { class: 'lp-editor', 'aria-label': 'Illustrative editor layout with real 12toons character artwork' },
    h('div', { class: 'lp-editor-top' }, h('span', { class: 'lp-dots', 'aria-hidden': 'true' }, '● ● ●'), h('strong', {}, '12toons Studio'), h('span', { class: 'lp-editor-live' }, 'Scene preview')),
    h('div', { class: 'lp-editor-main' },
      h('div', { class: 'lp-editor-rail', 'aria-hidden': 'true' }, h('span', {}, '🎙'), h('span', {}, '🎭'), h('span', {}, '🎥'), h('span', {}, '🎞')),
      h('div', { class: 'lp-editor-center' },
        h('div', { class: 'lp-editor-stage' },
          h('div', { class: 'lp-stage-glow' }),
          h('img', { src: pose('neha-front-side'), alt: 'Neha 2D character from the 12toons character library', width: '178', height: '240', fetchpriority: 'high' }),
          h('img', { src: pose('mybaby-front-side'), alt: 'My Baby 2D character from the 12toons character library', width: '178', height: '240', fetchpriority: 'high' }),
          h('div', { class: 'lp-speech' }, 'Hello! Let’s animate.')
        ),
        h('div', { class: 'lp-timeline', 'aria-label': 'Illustration of a timeline with audio and animation tracks' },
          h('div', { class: 'lp-timeline-label' }, h('span', {}, 'Audio'), h('span', {}, 'Animation'), h('span', {}, 'Camera')),
          h('div', { class: 'lp-timeline-tracks' }, h('span', { class: 'lp-track lp-track-wave' }), h('span', { class: 'lp-track lp-track-blue' }), h('span', { class: 'lp-track lp-track-purple' }))
        )),
      h('div', { class: 'lp-editor-tools' }, h('b', {}, 'CHARACTER'), h('img', { src: pose('neha-front'), alt: 'Front pose preview of Neha', loading: 'lazy', width: '120', height: '152' }), h('span', {}, 'Position · Motion · Face'))
    ), h('div', { class: 'lp-editor-caption' }, 'Illustrative interface · Actual 12toons character artwork')
  );
}

function characterStrip() {
  const characters = [
    ['Neha', 'neha-front-side'],
    ['My Baby', 'mybaby-front-side'],
    ['Village Boy', 'villageboy-front-side'],
    ['SVG Multi', 'svgmulti-front-side']
  ];
  return h('div', { class: 'lp-character-strip' }, characters.map(([name, file]) =>
    h('div', { class: 'lp-character' }, h('div', { class: 'lp-character-art' }, h('img', { src: pose(file), alt: name + ' character preview', loading: 'lazy' })), h('strong', {}, name))
  ));
}

export function landingView({ user, cta, profileMenu, logo }) {
  const gallery = h('div', { class: 'lp-gallery-grid' }, characterPreviews.map(({ title, desc, image }) =>
    h('article', { class: 'lp-preview-card' }, h('img', { src: image, alt: title + ' character pose', loading: 'lazy' }),
      h('div', { class: 'lp-preview-text' }, h('h3', {}, title), h('p', {}, desc)))
  ));

  const pricingLink = h('a', { href: '#/credits', onclick: (e) => { e.preventDefault(); window.location.hash = '#/credits'; } }, 'Pricing');
  const brand = logo(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  brand.prepend(h('img', { class: 'lp-brand-crown', src: '/images/royal-crown-emblem.png', alt: '', width: '64', height: '50' }));
  const primaryCta = (label) => h('span', { class: 'lp-button-content' }, h('img', { src: '/images/royal-crown-emblem.png', alt: '', width: '38', height: '38', loading: 'lazy' }), h('span', {}, label));
  const nav = h('nav', { class: 'lp-nav', 'aria-label': 'Main navigation' },
    navLink('Home', 'top'), navLink('Features', 'features'), navLink('Examples', 'examples'), navLink('How it works', 'how'), pricingLink);
  const mobileNav = h('nav', { class: 'lp-mobile-nav', 'aria-label': 'Mobile navigation' },
    navLink('Home', 'top'), navLink('Features', 'features'), navLink('Examples', 'examples'), navLink('How it works', 'how'),
    h('a', { href: '#/credits', onclick: (e) => { e.preventDefault(); window.location.hash = '#/credits'; } }, 'Pricing'), navLink('FAQ', 'faq'));

  return h('div', { class: 'sh lp' },
    h('header', { class: 'sh-bar lp-header' },
      brand, nav,
      user ? profileMenu() : button(primaryCta('Open my studio  →'), cta, 'primary', true)
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
            h('span', {}, h('b', {}, '♟'), h('strong', {}, 'AI Characters'), h('small', {}, 'Create & customise')),
            h('span', {}, h('b', {}, '♩'), h('strong', {}, 'Voice & Lip-sync'), h('small', {}, 'Natural dialogue')),
            h('span', {}, h('b', {}, '▦'), h('strong', {}, 'Editable Timeline'), h('small', {}, 'Direct every scene')),
            h('span', {}, h('b', { class: 'lp-export-medallion' }, h('img', { src: '/images/royal-export-medallion.png', alt: '', width: '48', height: '48', loading: 'lazy' })), h('strong', {}, 'Export Anywhere'), h('small', {}, 'Video from browser')))
        ),
        h('div', { class: 'lp-hero-visual' }, editorPreview())
      ),
      h('section', { class: 'lp-section lp-intro', id: 'characters' },
        h('div', { class: 'lp-intro-copy' }, eyebrow('Your cast, your world'), h('h2', {}, 'Characters that bring every scene to life'), h('p', {}, 'Choose from available 2D characters or build your own in Character Studio. Change colours, outfits and facial features, then animate them in your project.')),
        characterStrip()
      ),
      h('section', { id: 'features', class: 'lp-section lp-section-soft' },
        sectionTitle('All in one workspace', 'Create, direct and export in one place', 'From dialogue to character motion, 12toons gives you tools to make and fine-tune every scene.'),
        h('div', { class: 'lp-feature-grid' }, FEATURES.map(f => h('article', { class: 'lp-feature-card' },
          h('span', { class: 'lp-feature-icon', 'aria-hidden': 'true' }, f.icon),
          h('h3', {}, f.title), h('p', {}, f.body), h('small', {}, f.detail)
        )))
      ),
      h('section', { id: 'examples', class: 'lp-section lp-gallery-section' },
        sectionTitle('Meet the cast', 'Explore character poses', 'Choose a character template, customise its artwork and bring it into your own animated scenes.'),
        gallery,
        h('div', { class: 'lp-gallery-note' }, h('span', {}, 'Want to turn movement into a full scene?'), button('Open Animation Studio →', cta, 'outline'))
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

