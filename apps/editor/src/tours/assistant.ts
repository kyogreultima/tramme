// The assistant: how it reaches Claude, what it can do, how to keep control.

import { registerTour, inAtelier } from './engine.ts';
import { m } from '../i18n/index.ts';

registerTour({
  id: 'assistant',
  title: m('tours.assistant.workingWithTheAssistant'),
  summary: m('tours.assistant.accessModelProposalsConversations'),
  page: 'editor',
  available: inAtelier,
  order: 30,
  steps: [
    {
      target: 'assistant', side: 'left', align: 'end',
      title: m('common.theAssistant'),
      body: m('tours.assistant.itReadsTheDocument'),
    },
    {
      target: 'assistant-access', side: 'bottom', align: 'end',
      title: m('common.accessToClaude'),
      body: m('tours.assistant.forClaudeTwoPaths'),
    },
    {
      target: 'assistant-model', side: 'bottom', align: 'end',
      title: m('tours.assistant.theModel'),
      body: m('tours.assistant.claudeOpusForThe'),
    },
    {
      target: 'assistant-composer', side: 'top', align: 'center',
      title: m('tours.assistant.ask'),
      body: m('tours.assistant.justWriteWhatYou'),
    },
    {
      target: 'assistant-composer', side: 'top', align: 'center',
      title: m('tours.assistant.dictate'),
      body: m('tours.assistant.theMicrophoneWritesWhat'),
    },
    {
      target: 'assistant-composer', side: 'top', align: 'center',
      title: m('tours.assistant.whileItWorks'),
      body: m('tours.assistant.keepWritingMessagesQueue'),
    },
    {
      target: 'viewport', side: 'left', align: 'center',
      title: m('tours.assistant.proposals'),
      body: m('tours.assistant.itsChangesArriveAs'),
    },
    {
      target: 'assistant-history', side: 'bottom', align: 'end',
      title: m('common.conversations'),
      body: m('tours.assistant.eachConversationStaysIn'),
    },
  ],
});
