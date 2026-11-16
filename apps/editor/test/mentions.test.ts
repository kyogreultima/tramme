import { describe, expect, it } from 'vitest';
import { applyMention, assetMentions, expandMentions, mentionQuery, matchMentions, tagOfName } from '../src/mentions.ts';
import { piecesOf } from '../src/ai/commands.ts';

describe('a file of any name, tagged', () => {
  it('makes a tag of it that the box reads whole: commas, quotes and emoji made _, accents kept, composed', () => {
    const hamza = tagOfName('Hi, I’m Hamza Fareed. 👋 Creative Director. AI Creator. I design brands, websites and content that.mp4');
    expect(hamza).toBe('Hi_I_m_Hamza_Fareed._Creative_Director._AI_Creator._I_design_brands_websites_and_content_that.mp4');
    // a name whose accents are written apart (e and its grave): one letter again
    const secret = tagOfName('Le secret derrière ces apps.mp4');
    expect(secret).toBe('Le_secret_derrière_ces_apps.mp4');
    const tags = new Set([hamza, secret, 'tramme.mp4']);
    const marked = piecesOf(`/captions et @${hamza} et @tramme.mp4 et @${secret}`, (n) => n === 'captions', (t) => tags.has(t)).filter((p) => p.kind).map((p) => p.text);
    expect(marked).toEqual(['/captions', `@${hamza}`, '@tramme.mp4', `@${secret}`]);
  });
});

describe('the @ of a message', () => {
  it('finds the word being tagged at the caret, only after a space or at the start', () => {
    expect(mentionQuery('use @lo', 7)).toEqual({ from: 4, query: 'lo' });
    expect(mentionQuery('@', 1)).toEqual({ from: 0, query: '' });
    expect(mentionQuery('mail me@x', 9)).toBeNull();
    expect(mentionQuery('use @logo and more', 9)).toEqual({ from: 4, query: 'logo' });
    expect(mentionQuery('use @logo and more', 14)).toBeNull();
  });

  it('puts the chosen token in place of what was typed, with a space after', () => {
    expect(applyMention('use @lo now', { from: 4, query: 'lo' }, 'logo')).toEqual({ text: 'use @logo  now', caret: 10 });
    expect(applyMention('@', { from: 0, query: '' }, 'a')).toEqual({ text: '@a ', caret: 3 });
  });

  it('lists the assets of a document by id and name, media first, and matches what is typed', () => {
    const list = assetMentions({ assets: { logo: { type: 'image', name: 'Brand Logo' }, voice: { type: 'audio', name: 'Voice' }, data: { type: 'json' }, font1: { type: 'font', name: 'Inter' } } } as never);
    expect(list.map((m) => m.token)).toEqual(['logo', 'voice', 'data', 'font1']);
    expect(matchMentions(list, 'brand').map((m) => m.token)).toEqual(['logo']);
    expect(matchMentions(list, 'VO').map((m) => m.token)).toEqual(['voice']);
    expect(matchMentions(list, '')).toHaveLength(4);
  });

  it('says in the message what each tag stands for, and leaves what is not one', () => {
    const say = (token: string) => (token === 'logo' ? 'the image asset "logo": Brand Logo' : null);
    expect(expandMentions('put @logo top left, mail me@x.fr and @nobody', say)).toBe('put @logo (the image asset "logo": Brand Logo) top left, mail me@x.fr and @nobody');
  });
});

describe('a tag of a file named in another language', () => {
  it('is read whole at the caret and explained at send, accents included', () => {
    const name = 'Le_secret_derrière_ces_apps.mp4';
    expect(mentionQuery(`voir @Le_secret_derri`, 21)).toEqual({ from: 5, query: 'Le_secret_derri' });
    expect(expandMentions(`voir @${name} ici`, (tk) => (tk === name ? 'the attached file' : null))).toBe(`voir @${name} (the attached file) ici`);
  });
});
