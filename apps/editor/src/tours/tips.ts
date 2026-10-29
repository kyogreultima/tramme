// The tricks: the features that do not jump out — zooming the timeline, the
// lasso, the video cut, the timeline's menus, scrub labels, arithmetic in fields,
// the keyboard. One pass, and the editor holds no surprise any more.

import { comp, S, select } from '../state.ts';
import { press, registerTour, inAtelier } from './engine.ts';
import { m } from '../i18n/index.ts';

/** the first video layer of the open composition, if any */
const firstVideo = () => Object.entries(comp.peek().layers).find(([, l]) => l.type === 'video')?.[0];
const selectVideo = () => { press('left-tab-layers'); const id = firstVideo(); if (id) select([id]); };

registerTour({
  id: 'tips',
  title: m('tours.tips.theTricks'),
  summary: m('tours.tips.featuresThatDoNot'),
  page: 'editor',
  order: 15,
  available: () => S.ready.value && inAtelier(),
  steps: [
    {
      title: m('tours.tips.theTricks'),
      body: m('tours.tips.littleGesturesHidden'),
    },
    {
      target: 'timeline', side: 'top', align: 'center',
      title: m('tours.tips.zoomAndLasso'),
      body: m('tours.tips.ctrlOrCmdAnd'),
    },
    {
      target: 'timeline', side: 'top', align: 'center',
      title: m('tours.tips.edgesThatSnap'),
      body: m('tours.tips.aClipsEdgesMagnetise'),
    },
    {
      target: 'timeline', side: 'top', align: 'center',
      before: selectVideo,
      when: () => !!firstVideo(),
      title: m('tours.tips.cutAVideo'),
      body: m('tours.tips.dragTheLeftEdge'),
    },
    {
      target: 'inspector', side: 'left', align: 'start',
      before: selectVideo,
      when: () => !!firstVideo(),
      title: m('tours.tips.thePassageAtAGlance'),
      body: m('tours.tips.theCutInTheFile'),
    },
    {
      target: 'timeline', side: 'top', align: 'center',
      title: m('tours.tips.theClipsSayMore'),
      body: m('tours.tips.thumbsAlongTheVideoClips'),
    },
    {
      target: 'inspector', side: 'left', align: 'start',
      before: selectVideo,
      when: () => !!firstVideo(),
      title: m('tours.tips.playAtItsSpeed'),
      body: m('tours.tips.theSpeedOfAVideo'),
    },
    {
      target: 'timeline', side: 'top', align: 'center',
      title: m('tours.tips.theRightClick'),
      body: m('tours.tips.rightClickTheTimeline'),
    },
    {
      target: 'inspector', side: 'left', align: 'start',
      title: m('tours.tips.scrubAndArithmetic'),
      body: m('tours.tips.dragAPropertysLabel'),
    },
    {
      target: 'inspector', side: 'left', align: 'start',
      title: m('tours.tips.beyondTheStaticValue'),
      body: m('tours.tips.theDotsOfAProperty'),
    },
    {
      target: 'inspector', side: 'left', align: 'start',
      title: m('tours.tips.masksOnALayer'),
      body: m('tours.tips.theMasksSectionAdds'),
    },
    {
      target: 'ai-resizer', side: 'left', align: 'center',
      title: m('tours.tips.theLinesBetween'),
      body: m('tours.tips.everyLineBetween'),
    },
    {
      target: 'viewport', side: 'left', align: 'center',
      title: m('tours.tips.moveAroundTheFrame'),
      body: m('tours.tips.theWheelZoomsThe'),
    },
    {
      target: 'viewport-tools', side: 'bottom', align: 'start',
      title: m('tours.tips.framingAids'),
      body: m('tours.tips.safeZonesTheGrid'),
    },
    {
      target: 'transport', side: 'top', align: 'center',
      title: m('tours.tips.playWithTheKeyboard'),
      body: m('tours.tips.spacePlaysThe'),
    },
    {
      target: 'history', side: 'bottom', align: 'end',
      title: m('tours.tips.undoRedoAndRename'),
      body: m('tours.tips.theTwoArrowsUndo'),
    },
    {
      target: 'versions', side: 'bottom', align: 'start',
      title: m('tours.tips.goBackInTime'),
      body: m('tours.tips.theClockBesideTheSaved'),
    },
    {
      target: 'export', side: 'bottom', align: 'end',
      title: m('tours.tips.exportWithoutSurprises'),
      body: m('tours.tips.motionBlurFollowsThe'),
    },
    {
      title: m('tours.tips.thatIsTheLot'),
      body: m('tours.tips.everythingElseExplains'),
    },
  ],
});
