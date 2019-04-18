import Ember from 'ember';
import { inject as service } from '@ember/service';

export default Ember.Component.extend({
  ajax: service(),

  didInsertElement() {
    this.loadMessageBoard();
  },

  loadMessageBoard() {
    this.get('ajax').request(`/userMessages/active`)
    .then((data)=> {
      this.set('messageBoard', data);
    });
  },

  actions: {
    refreshDashboard() {
      this.loadMessageBoard();
    }
  }
});
