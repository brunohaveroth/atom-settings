const CriteriaParser = require('./criteriaProcessor');

var Find = function(req) {
  let modelName = req.options.model || req.options.controller;
  let Model = req._sails.models[ modelName.toLowerCase() ];
  let criteriaParser = new CriteriaParser(modelName, Model.definition);

  let parsedCriteria = criteriaParser.read(req.query);
  parsedCriteria.joins = _.uniq(parsedCriteria.joins, 'alias');

  let joins = '';
  parsedCriteria.joins.forEach((join)=> {
    let tableJoin = join.model,
      tableJoinAlias = join.alias;

    let contentJoin = ' LEFT JOIN $tableJoin $tableJoinAlias ON $tableName.$tableJoinAlias = $tableJoinAlias.id ';

    contentJoin = contentJoin.replace(/\$tableName/g, modelName);
    contentJoin = contentJoin.replace(/\$tableJoinAlias/g, tableJoinAlias);
    contentJoin = contentJoin.replace(/\$tableJoin/g, tableJoin);

    joins += contentJoin;
  });

  let queryStructure = {
    columns: '$tableName.*',
    joins,
    where: parsedCriteria.query,
    additionalColumns: [],
    additionalJoins: [],
    additionalWhere: []
  }

  this.tableName = modelName.toLowerCase();
  this.parsedCriteria = parsedCriteria;
  this.queryStructure = queryStructure;
  this.model = Model;

  return this;
};

Find.prototype.addColumns = function(columns) {
  this.queryStructure.additionalColumns.push(columns);
  return this;
}

Find.prototype.addJoins = function(joins) {
  this.queryStructure.additionalJoins.push(joins);
  return this;
}

Find.prototype.addWhere = function(where) {
  this.queryStructure.additionalWhere.push(where);
  return this;
}

Find.prototype.columns = function(columns) {
  this.queryStructure.columns = columns;
  return this;
}

Find.prototype.joins = function(joins) {
  this.queryStructure.joins = joins;
  return this;
}

Find.prototype.where = function(where) {
  this.queryStructure.where = where;
  return this;
}

Find.prototype.total = function(where) {
  this.returnTotal = true;
  return this;
}

Find.prototype.run = async function(where) {
  let currentQuery = this.currentQuery();

  let execQuery = (q)=> {
    return new Promise((resolve, reject)=> {
      this.model.query(1, null, function(err, data) {
        if (err) return reject(err);
        resolve(data);
      });
    });
  }

  if (this.returnTotal) {
    return execQuery(currentQuery.query);
  } else {
    return Promise.all([
      execQuery(currentQuery.query),
      execQuery(currentQuery.count)
    ]).then((result)=> {
      let [ data, count ] = result;
      return { data, count };
    })
  }
}

Find.prototype.currentQuery = function() {
  let queryStructure = this.queryStructure;
  let query = `SELECT $columns FROM $tableName $joins WHERE $where`;
  let count = `SELECT COUNT(0) FROM $tableName $joins WHERE $where`;

  let columns = queryStructure.columns;
  queryStructure.additionalColumns.forEach((additional)=> {
    columns += `, ${additional}`;
  });

  let joins = queryStructure.joins;
  queryStructure.additionalJoins.forEach((additional)=> {
    joins += `, ${additional}`;
  });

  let where = queryStructure.where;
  queryStructure.additionalWhere.forEach((additional)=> {
    where += `, ${additional}`;
  });

  query = query.replace(/\$columns/g, columns)
    .replace(/\$joins/g, joins)
    .replace(/\$where/g, where)
    .replace(/\$tableName/g, this.tableName);

  count = count.replace(/\$columns/g, columns)
    .replace(/\$joins/g, joins)
    .replace(/\$where/g, where)
    .replace(/\$tableName/g, this.tableName);


  this.parsedCriteria.values.forEach((value, index)=> {
    query = query.replace('$' + (index + 1), value);
    count = count.replace('$' + (index + 1), value);
  });
  console.log('query', query);
  console.log('count', count);
  return {query, count};
};


module.exports = Find;
