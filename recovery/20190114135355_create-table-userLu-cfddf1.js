exports.up = function (knex, Promise) {
  return knex.schema.createTable('userlunchsolicitation', function (t) {
    t.increments();
    t.integer('company')

    t.integer('user');
    t.integer('deletedBy');
    t.integer('day');
    t.integer('month');
    t.integer('year');
    t.boolean('confirmed');

    t.dateTime('createdAt');
    t.dateTime('updatedAt');
  });
};

exports.down = function (knex, Promise) {
  return knex.schema.dropTable('userlunchsolicitation');
};
