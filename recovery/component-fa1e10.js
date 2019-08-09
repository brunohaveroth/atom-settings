import Component from '@ember/component';
import { set } from '@ember/object';

export default Component.extend({
  classNames: ['mobile-banner'],
  classNameBindings: ['showBanner:d-block:d-none'],

  didInsertElement() {
    if (/Android/i.test(navigator.userAgent)) {
      set(this, 'isAndroid', true);
      set(this, 'showBanner', true);
    }

    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      set(this, 'isIOS', true);
      set(this, 'showBanner', true);
    }
  }
});
