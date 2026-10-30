import { describe, expect, it } from 'vitest';
import { applyMention, assetMentions, expandMentions, mentionQuery, matchMentions } from '../src/mentions.ts';

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
