import { h, brandWordmark } from './dom.js';
import './legal.css';

const UPDATED = '22 October 2026';

const TERMS = [
  ['1. About these terms', [
    'These Terms of Use apply when you visit or use the 12toons website, Animation Studio, Character Studio, account features and related services (together, “12toons”). By using 12toons, you agree to these terms. Stop using the service if you do not agree.',
    '12toons is the service name shown on this website. This build does not publish a separate operating-company name or postal address. No governing-law or court-location clause is stated here because the operator’s legal jurisdiction has not been supplied. Consumer and other rights that apply by law remain in force.'
  ]],
  ['2. Who may use 12toons and accounts', [
    'You must be legally able to agree to these terms where you live. If you are under the age at which you can agree to online service terms in your location, use 12toons only with the involvement and permission of a parent or legal guardian where required.',
    'Studio access uses Google sign-in. Keep access to your Google account and any AI provider credentials secure. You are responsible for activity performed through your account and for giving accurate account information. Do not share an account or try to use another person’s account without permission.',
    'Staff access is limited to accounts the service administrator has enabled. Staff access does not give you permission to bypass account security or view another user’s private project data.'
  ]],
  ['3. The service and availability', [
    '12toons provides browser-based tools to create and edit 2D animation projects and characters, work with audio and images, and export video. Features, supported file types and limits may change as the service is maintained.',
    'The service may be interrupted for maintenance, security work, technical issues or changes to third-party services. We do not promise uninterrupted access, a particular response time, or that every feature will work on every device or browser.',
    'The current site identifies a free plan. AI features can involve separate charges from OpenRouter or a model provider when you use your own provider account and API key. Review provider pricing before sending requests.'
  ]],
  ['4. Your projects and uploaded material', [
    'You keep the rights you already hold in scripts, characters, images, audio, project files and other material you create or upload (“Your Content”). You are responsible for having permission to use that material, including permission from people whose voices, likenesses or personal information appear in it.',
    'When you use a feature, you give 12toons permission to receive, reproduce, convert, render, transmit, store and back up Your Content only as needed to provide that feature, keep the service secure, and maintain your project. This permission is limited to operating the service. It does not authorize public display, advertising use, or sale of Your Content.',
    'Projects are saved in browser storage on your device. When account cloud storage is available and sync is enabled, project information and files may be stored using Firebase Firestore and Cloudflare R2. Authorized infrastructure operators may have technical access to stored data. The in-app admin role does not itself grant access to a user’s workspace.',
    'If you submit an Affiliate Partners request, we collect the name, email address, phone or WhatsApp number, company or creator brand, platform, optional audience size, profile link and partnership message you provide. The request is stored in Firebase Firestore and available to enabled administrators so they can review it, update its status and contact you about the request. Approved partners can link their referral dashboard by signing in with the same Google email address. Providing the form is optional; a request does not guarantee acceptance into an affiliate program.',
    'When a visitor follows an approved partner’s referral link, we record a daily unique click using a one-way hash of the visitor IP address and may save the referral code in that browser for signup attribution. If a new account signs up within seven days with that code, we record the account identifier, referral partner and signup time. If that account later makes a credit purchase that Razorpay confirms as captured, we record the purchase and calculated commission for the partner. Enabled administrators can review click, signup, purchase, commission and payout records. The partner dashboard shows totals and purchase details without revealing referred users’ email addresses. Payouts are recorded manually by an administrator with a transaction reference; the dashboard does not initiate bank transfers.',
    'Browser storage can be cleared, a device can fail, and cloud service availability can change. Keep copies of important source files and exports. In this build, deleting a project removes its project entry, while old stored file chunks may remain because automatic storage cleanup is not implemented.'
  ]],
  ['5. Optional AI features and third-party services', [
    'The AI direction and transcription features are optional. They use the OpenRouter API directly from your browser with an API key you provide. The key is kept in that browser’s local storage and is sent to OpenRouter when you use the feature.',
    'A direction request may send dialogue context and selected character or animation details. A transcription request sends the audio you selected. OpenRouter and the model provider process those requests under their own terms and privacy policies. Their available models, data handling, retention settings and prices may change. Read the [OpenRouter Terms of Service](https://openrouter.ai/terms) and [OpenRouter Privacy Policy](https://openrouter.ai/privacy/) before use.',
    'AI results can be inaccurate, incomplete, unsuitable or similar to material produced for others. Review every result, confirm that you may use it, and make your own creative and legal decisions before publishing or relying on it. 12toons does not promise that an AI result is original or cleared for a particular use.',
    'Google, Firebase, Cloudflare, OpenRouter and model providers operate services under their own terms. Their availability and handling of data are outside 12toons’ direct control. Your use of those services is also subject to their applicable terms and policies.'
  ]],
  ['6. Acceptable use', [
    'Use 12toons lawfully and respectfully. You agree not to:',
    ['Upload or generate material that violates another person’s copyright, privacy, publicity, contract or other rights.', 'Use the service for unlawful threats, harassment, fraud, exploitation, malware or harmful activity.', 'Probe, disrupt, overload or attempt to gain unauthorized access to accounts, APIs, storage, infrastructure or security controls.', 'Misuse another person’s account, API key, device or personal information.', 'Extract or redistribute bundled characters, artwork, animation, audio, software or other materials except where the Website Licence or a separate notice permits it.', 'Use an export or AI result in a way that violates applicable law or the terms of a relevant provider.'],
    'We may restrict or suspend access when reasonably needed to protect users, enforce these terms, respond to legal requirements or address security risks.'
  ]],
  ['7. Ownership and permissions', [
    'The 12toons website, name, branding, software, interface, documentation and bundled media are owned by or licensed to their respective rights holders. Your access is governed by the [Website Licence](/#/website-license), which forms part of these terms.',
    'You may share or publish Your Content and your exports when you hold the necessary rights. An export can contain bundled or third-party material with separate restrictions. Check the Website Licence and any asset-specific notice before distributing an export.'
  ]],
  ['8. Fees and provider charges', [
    'The site currently presents a free plan. OpenRouter or model-provider charges are separate and may apply to AI requests made with your provider account. You are responsible for those charges and for securing your API key. 12toons does not control third-party prices or billing.',
    'The Buy Credits page offers optional one-time purchases in Indian rupees. The listed packages are ₹450 for 500 credits, ₹850 for 1,000 credits, and ₹999 for 1,500 credits. The page displays a 30% discount against a calculated reference price. Razorpay processes checkout; the applicable plan price is fixed by the server and charged only after you authorize the payment.',
    'Credits are added to the signed-in account after the payment provider confirms capture. The account page and admin payment report show the recorded payment status. Credits currently do not pay for the existing AI tools, which use your own OpenRouter API key. Do not buy credits on the assumption that they can currently be spent in those tools. Keep your payment confirmation and contact the website operator if a captured payment is not reflected in your balance.',
    'No recurring subscription is created by these packages. Payment, cancellation and refund rights remain subject to applicable law and the payment provider’s applicable terms. Nothing in these terms removes a right that cannot legally be limited.',
    'Affiliate commissions are calculated only for eligible, captured credit purchases attributed to a newly created account. The administrator sets the current percentage, which may change for future purchases. Commission records show pending until an administrator confirms an external payout and records its reference. The affiliate dashboard is a report; it does not send money or promise a particular number of referrals, sales or earnings.'
  ]],
  ['9. Changes, suspension and ending use', [
    'You can stop using 12toons at any time. Signing out does not erase browser data or cloud files. Delete projects and remove locally stored credentials using the available controls and your browser settings; old cloud file chunks may remain as described above.',
    'We may change, pause or discontinue a feature. We may suspend or end access when needed for security, legal compliance, misuse or service operation. Where practical, we will provide notice through the service.'
  ]],
  ['10. Disclaimers and liability', [
    'To the extent the law allows, 12toons is provided as available, without a promise that it will be error-free, continuously available, or suitable for a particular project. You are responsible for checking project files, exports and AI results before relying on or distributing them.',
    'To the extent the law allows, 12toons is not responsible for indirect or consequential loss, loss of expected profits, or loss caused by third-party services, browser or device failures, or copies of data you did not preserve. Nothing in these terms excludes liability or consumer rights that the law does not allow to be excluded or limited.'
  ]],
  ['11. Updates to these terms', [
    `We may update these terms when the service changes. The date at the top shows the latest revision in this build. Continued use after a revised version is posted means you accept the revised terms, to the extent permitted by applicable law.`
  ]],
  ['12. Contact and legal information', [
    'For help, contact the person or organization that provided you with the 12toons website or account access. This build does not publish a separate support email, legal entity name, postal address or governing jurisdiction; those details should be added by the service operator when available.'
  ]]
];

const LICENCE = [
  ['1. What this licence covers', [
    'This Website Licence explains the permissions for using 12toons and the materials delivered through it. It applies alongside the Terms of Use. A separate notice attached to a particular file or third-party component takes precedence for that material.'
  ]],
  ['2. 12toons website and software', [
    'The 12toons name, logo, page design, original site copy, interface, application code and service materials are reserved to 12toons or their respective rights holders. No open-source licence is granted for the 12toons application or brand by this page.',
    'While you follow the Terms of Use, 12toons grants you a limited, personal, non-exclusive, non-transferable and revocable permission to access the site and use its studios for their intended creative functions. You may not resell access, sublicense the website, copy substantial parts of the service, remove rights notices, or redistribute the application or its assets as a separate product.'
  ]],
  ['3. Your work and exports', [
    'You retain the rights you hold in original material that you create or upload. 12toons does not claim ownership of your scripts, recordings, imported artwork, project edits or original characters.',
    'You may use and distribute your own material and exports when you have the necessary rights. An export does not transfer ownership of the 12toons software, bundled content, third-party code or third-party material included in the export. You remain responsible for checking those separate rights before sharing, selling or licensing an export.'
  ]],
  ['4. Bundled characters, animation and media', [
    'This build does not publish a blanket commercial licence for bundled character artwork, character designs, animation clips, poses, backgrounds, audio or other media. Unless an asset has a separate permission notice, use bundled media within 12toons to make and preview projects. Do not extract, repackage, sell, sublicense or distribute bundled media as standalone files or as a competing asset library.',
    'Before distributing or monetizing an export that includes bundled media, check the rights notice for each asset and obtain any permission that notice requires. The service operator should add asset-specific licence details here when those rights have been confirmed.'
  ]],
  ['5. Your permission to process uploaded content', [
    'When you upload or sync files, you give 12toons a limited, worldwide, non-exclusive permission to store, copy, convert, transmit and render those files only as required to run the features you choose, sync your projects, protect the service and maintain its operation. This permission does not allow 12toons to sell your files or publish them as promotional content.',
    'You confirm that you have the rights and permissions required to provide the files and to grant this limited permission. This permission continues only for as long as processing or storage is needed for the service and its backups, subject to applicable law and the storage behavior described in the Terms of Use.'
  ]],
  ['6. Third-party software and services', [
    'The bundled DragonBones JavaScript runtime includes its own MIT licence and copyright notice. That licence covers the DragonBones runtime code identified by that notice; it does not change the rights for 12toons branding, application code or character artwork. Read the [DragonBonesJS MIT licence](https://github.com/DragonBones/DragonBonesJS/blob/master/LICENSE).',
    'Other software libraries, fonts, media and services may carry separate licences or terms. Those notices continue to apply to the material they cover. Google, Firebase, Cloudflare, OpenRouter and model-provider names and marks belong to their respective owners.'
  ]],
  ['7. Reporting a rights concern', [
    'If you believe material on the site uses your work without permission, contact the person or organization that provided you with the 12toons website or account access. Include the page or asset, a description of the rights you hold, and a way to respond. Do not send passwords, API keys or unrelated private files.'
  ]],
  ['8. Licence summary', [
    'Use 12toons to create projects under the Terms of Use. Keep ownership of the original content you bring. Preserve third-party notices. Treat bundled media as separately restricted unless its own notice grants broader rights. Ask the relevant rights holder before uses that go beyond the permission stated here.'
  ]]
];

function section([title, blocks]) {
  return h('section', { class: 'legal-section' }, h('h2', {}, title), blocks.map(block => {
    if (Array.isArray(block)) return h('ul', {}, block.map(item => h('li', {}, item)));
    if (block.includes('[OpenRouter Terms of Service]')) {
      return h('p', {}, 'A direction request may send dialogue context and selected character or animation details. A transcription request sends the audio you selected. These requests go directly from your browser to OpenRouter and model providers, under their own terms and privacy policies. Their available models, data handling, retention settings and prices may change. Read the ',
        h('a', { href: 'https://openrouter.ai/terms', target: '_blank', rel: 'noopener noreferrer' }, 'OpenRouter Terms of Service'), ' and ',
        h('a', { href: 'https://openrouter.ai/privacy/', target: '_blank', rel: 'noopener noreferrer' }, 'OpenRouter Privacy Policy'), ' before use.');
    }
    if (block.includes('[Website Licence]')) return h('p', {}, 'The 12toons website, name, branding, software, interface, documentation and bundled media are owned by or licensed to their respective rights holders. Your access is governed by the ', h('a', { href: '/#/website-license' }, 'Website Licence'), ', which forms part of these terms.');
    if (block.includes('[DragonBonesJS MIT licence]')) return h('p', {}, 'The bundled DragonBones JavaScript runtime includes its own MIT licence and copyright notice. That licence covers the DragonBones runtime code identified by that notice; it does not change the rights for 12toons branding, application code or character artwork. Read the ', h('a', { href: 'https://github.com/DragonBones/DragonBonesJS/blob/master/LICENSE', target: '_blank', rel: 'noopener noreferrer' }, 'DragonBonesJS MIT licence'), '.');
    return h('p', {}, block);
  }));
}

export function legalView({ kind, home }) {
  const isTerms = kind === 'terms';
  const title = isTerms ? 'Terms of Use' : 'Website Licence';
  document.title = `12toons | ${title}`;
  const sections = isTerms ? TERMS : LICENCE;
  return h('div', { class: 'legal-page' },
    h('header', { class: 'legal-header' }, h('a', { class: 'legal-brand', href: '/#/', style: 'text-decoration:none', 'aria-label': '12toons home' }, ...brandWordmark()), h('nav', {},
      h('a', { href: '/#/' }, 'Home'), h('a', { href: '/#/terms' }, 'Terms of Use'), h('a', { href: '/#/website-license' }, 'Website Licence'))),
    h('main', { class: 'legal-main' },
      h('p', { class: 'legal-kicker' }, '12TOONS · SERVICE INFORMATION'),
      h('h1', {}, title),
      h('p', { class: 'legal-updated' }, `Last updated ${UPDATED}`),
      h('p', { class: 'legal-intro' }, isTerms
        ? 'Read these terms before creating, uploading, syncing or exporting work with 12toons.'
        : 'This page describes what you may do with the 12toons website, your own work, bundled media and third-party software.'),
      h('div', { class: 'legal-notice' }, 'Plain-language service terms for the current 12toons build. Rights that apply by law continue to apply.'),
      sections.map(section),
      h('div', { class: 'legal-switch' }, isTerms ? 'Related page:' : 'Related page:', ' ', h('a', { href: isTerms ? '/#/website-license' : '/#/terms' }, isTerms ? 'Website Licence' : 'Terms of Use'))
    ),
    h('footer', { class: 'legal-footer' }, h('a', {href:'/#/',style:'color:inherit;text-decoration:none'}, '© 2026 12toons'), h('span', {}, 'Use of the service is subject to these pages.'), h('button', { onclick: home }, 'Back to 12toons'))
  );
}
