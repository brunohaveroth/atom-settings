import Component from '@ember/component';
import { inject as service } from '@ember/service';
import { task, timeout } from 'ember-concurrency';
import { debug } from '@ember/debug';

export default Component.extend({
  tagName: '',

  chatService: service(),

  // Life Cycle
  init() {
    this._super(...arguments);
    // this.chatService.loadOpenChats();
  },

  loadOpenChats: task(function * (search) {
    try {
      yield timeout(500);
      this.chatService.loadOpenChats();
    } catch (e) {
      return debug(e);
    }
  }).restartable()
});
