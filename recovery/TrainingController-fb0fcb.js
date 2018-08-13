/**
 * TrainingController
 *
 * @description :: Server-side logic for managing trainings
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
var moment = require('moment');
var _ = require('lodash');
var tinycolor = require("tinycolor2");

let java = require("java");
const Promise = require("bluebird");
const blueprintCreate = require('sails-generate-ember-blueprints/templates/basic/api/blueprints/create.js');
const actionUtil = require('sails-generate-ember-blueprints/templates/advanced/api/blueprints/_util/actionUtil');

module.exports = {
  find(req, res) {
    var toManage = req.query.toManage;
    delete req.query.toManage;

    var Model = actionUtil.parseModel(req);

    var criteria = actionUtil.parseCriteria(req);
    var limit = actionUtil.parseLimit(req);

    var associations = actionUtil.getAssociationConfiguration(Model, "list");

    async.parallel({
        count: function(done) {
          Model.count(criteria).exec(done);
        },
        records: function(done) {
          // Lookup for records that match the specified criteria
          var query = Model.find()
            .where(criteria)
            .skip(actionUtil.parseSkip(req))
            .sort(actionUtil.parseSort(req));

          if (limit) query.limit(limit);

          // populate associations according to our model specific configuration...
          query = actionUtil.populateRecords(query, associations);
          query.exec(done);
        }
      },
      function(err, results) {
        if (err) return res.serverError(err);

        /** Validação para não listar agendamentos
         * para o usuário não instrutor na tela de gerenciamento **/
        if (toManage) {
          results.records = _.filter(results.records, (record) => {
            if (_.find(record.trainers, {
                id: req.user.id
              }) || req.user.admin) {
              return true;
            } else {
              return false;
            }
          });
        }
        /*******************************/

        var matchingRecords = results.records;
        var ids = _.map(matchingRecords, 'id');

        actionUtil.populateIndexes(Model, ids, associations, function(err, associated) {

          if (err) return res.serverError(err);

          if (req._sails.hooks.pubsub && req.isSocket) {
            Model.subscribe(req, matchingRecords);
            if (req.options.autoWatch) {
              Model.watch(req);
            }

            _.each(matchingRecords, function(record) {
              actionUtil.subscribeDeep(req, record);
            });
          }

          var emberizedJSON = Ember.buildResponse(Model, results.records, associations, true, associated);

          emberizedJSON.meta = {
            total: results.count
          };
          res.ok(emberizedJSON);

        });
      });
  },

  create(req, res) {
    // Adiciona o usuário logado como admin do treinamento antes de criar.
    req.body.training.admins = [req.user.id];

    blueprintCreate(req, res);
  },

  ajax: require('../blueprints/ajax'),

  destroy(req, res) {
    let id = req.params.id;

    return Training
      .findOne({
        id: id
      })
      .then((trainingFound) => {
        if (!trainingFound) return res.badRequest('Este treinamento não existe.');

        return TrainingDate
          .find({
            training: trainingFound.id
          })
          .then((trainingDates) => {
            return Promise.each(trainingDates, (trainingDate) => {
              return trainingDate.destroy()
                .then(() => {
                  return TrainingDateService.afterDestroy(trainingDate);
                });
            });
          })
          .then(() => {
            return trainingFound.destroy()
              .then(() => {
                return res.ok(null);
              });
          });
      })
      .catch(res.badRequest);
  },

  findClosedTraining(req, res) {
    const training = req.body.trainingGeneric;
    const user = req.body.user;
    const jobFunction = req.body.jobFunction;
    const start = req.body.start;
    const end = req.body.end;

    let where = {
      company: req.query.company,
      finished: false
    };

    if (training) {
      where.trainingGeneric = training;
    }

    if (jobFunction) {
      where.generatedByFunction = jobFunction;
    }

    if (start && end) {
      where.createdAt = {
        '>=': moment(start).format('YYYY-MM-DD'),
        '<=': moment(end).format('YYYY-MM-DD')
      };
    }

    let promise = Training.find().where(where)
      .populate('trainingGeneric')
      .populate('generatedByFunction');

    if (user) {
      promise.populate('users', {
        where: {
          id: user
        }
      });
    } else {
      promise.populate('users');
    }

    return promise.then((data) => {
      return res.ok(data);
    });
  },

  items(req, res) {
    let id = req.params.id;

    return Training
      .findOne({
        id: id
      })
      .populate('items')
      .then((trainingFound) => {
        let items = trainingFound ? trainingFound.items : [];
        return res.ok({
          'item': items
        });
      })
      .catch((err) => {
        return req.badRequest(err);
      });
  },

  participantStatus(req, res) {
    let trainingId = req.params.id;

    return Training
      .findOne({
        id: trainingId
      })
      .populate('users')
      .populate('teams')
      .populate('trainingDates')
      .then((trainingFound) => {
        if (!trainingFound) return res.badRequest('Treinamento não encontrado.');

        // Popula os participantes do treinamento levando em conta se o mesmo usa turmas ou participantes
        if (trainingFound.useTeam) {
          return Team.find({
              id: _.map(trainingFound.teams, 'id')
            })
            .populate('users')
            .then((teamsFound) => {
              let users = [];

              teamsFound.forEach((team) => {
                users = users.concat(team.users);
              });

              trainingFound.usersPopulated = _.uniq(users, 'id');

              return trainingFound;
            });
        } else {
          trainingFound.usersPopulated = trainingFound.users;

          return trainingFound;
        }
      })
      .then((training) => {
        // Calcula a duração do treinamento em minutos e a duração de cada trainingDate.
        let totalMinutesDuration = 0;
        training.trainingDates = _.map(training.trainingDates, (trainingDate) => {
          let momentModel = moment();

          let startTrainingM = __createMomentOfTime(momentModel.clone(), trainingDate.startTime);
          let endTrainingM = __createMomentOfTime(momentModel.clone(), trainingDate.endTime);

          let minutesDuration = endTrainingM.diff(startTrainingM, 'minutes');

          totalMinutesDuration += minutesDuration;
          trainingDate.minutesDuration = minutesDuration;

          return trainingDate;
        });

        training.totalMinutesDuration = totalMinutesDuration;
        training.hoursTotalDuration = (totalMinutesDuration / 60).toFixed(1);

        return training;

        function __createMomentOfTime(momentModel, time) {
          let splited = (time || '').split(':');
          momentModel.set({
            hour: _.first(splited),
            minute: _.last(splited),
            second: 0
          });
          return momentModel;
        }
      })
      .then((training) => {
        // Popula o training com todas as notas e presenças do mesmo.
        let FindNotesP = TrainingNote.find({
          training: training.id
        })
        let FindPresencesP = TrainingPresence.find({
          training: training.id
        })

        return Promise.join(FindNotesP, FindPresencesP)
          .spread((notesFound, presencesFound) => {
            training.notesPopulated = notesFound;
            training.presencesPopulated = presencesFound;
            return training;
          });
      })
      .then((training) => {
        let userData = _.map(training.usersPopulated, (user) => {
          let raw = {};

          raw.id = user.id;
          raw.fullName = user.firstName + ' ' + user.lastName;
          raw.email = user.email;
          raw.cpf = user.cpf;
          raw.faults = __processUserFaults(training, user.id);
          raw.frequency = __processUserFrequency(training, user.id);
          raw.note = __findUserNote(training.notesPopulated, user.id);
          raw.status = __processUserStatus(training, raw);

          return raw;
        });

        let trainingData = {
          hoursTotalDuration: training.hoursTotalDuration,
          minFrequency: training.frequency,
          minNote: training.note
        };

        return res.ok({
          trainingData: trainingData,
          userData: userData
        });

        function __processUserFaults(training, userId) {
          // Calcula as faltas do participante.
          let minutesFaults = 0;
          training.trainingDates.forEach((trainingDate) => {
            let isPresent = _.find(training.presencesPopulated, {
              trainingDate: trainingDate.id,
              user: userId,
              presence: true
            });

            minutesFaults += isPresent ? 0 : trainingDate.minutesDuration;
          });

          return minutesFaults ? (minutesFaults / 60).toFixed(1) : 0;
        }

        function __findUserNote(notesPopulated, userId) {
          let found = _.find(notesPopulated, {
            user: userId
          });
          return found ? found.note : 'Sem Nota';
        }

        function __processUserFrequency(training, userId) {
          // Calcula quantos % de frequecia o participante tem do treinamento.
          let trainingMinutesDuration = training.totalMinutesDuration;
          let minutesPresent = 0;

          training.trainingDates.forEach((trainingDate) => {
            let isPresent = _.find(training.presencesPopulated, {
              trainingDate: trainingDate.id,
              user: userId,
              presence: true
            });
            minutesPresent += isPresent ? trainingDate.minutesDuration : 0;
          });

          if (!trainingMinutesDuration) {
            return 100;
          } else {
            return parseInt(Utils.percentOf(minutesPresent, trainingMinutesDuration));
          }
        }

        function __processUserStatus(training, raw) {
          // Verifica se o participante está aprovado ou reprovado baseado em sua nota e faltas
          let minFrequency = training.frequency;
          let minNote = training.note;

          let status = 'Aprovado';

          if (raw.note < minNote) {
            status = 'Repro. por Nota';
          }

          if (isNaN(raw.note)) {
            status = 'Pendente';
          }

          if (raw.frequency < minFrequency) {
            status = 'Repro. por Falta';
          }

          if (raw.frequency < minFrequency && raw.note < minNote) {
            status = 'Repro. por Falta/Nota';
          }

          return status;
        }
      });
  },

  calendar(req, res) {
    if (req.query) {
      var start = moment(new Date())
      if (req.query.start) {
        start = moment(req.query.start, 'YYYY-MM-DD').toDate();
      }

      var end = moment(new Date())
      if (req.query.end) {
        end = moment(req.query.end, 'YYYY-MM-DD').toDate();
      }

      TrainingDate.find()
        .where({
          company: req.query.company,
          date: {
            '>': start,
            '<': end
          }
        })
        .populate('training')
        .then((data) => {
          return Promise.map(data, __buildCalendarObject)
            .then((response) => {
              return res.ok(_.compact(response));
            })
            .catch(res.badRequest);

          function __buildCalendarObject(trainingData) {
            if (!trainingData || !trainingData.training) return;

            return TrainingGeneric
              .findOne({
                id: trainingData.training.trainingGeneric
              })
              .then((trainingGenericFound) => {
                if (!trainingGenericFound) return;

                let color = tinycolor(trainingGenericFound.color);
                let dateM = moment(trainingData.date)
                let startM = Utils.timeToMomentDate(dateM, trainingData.startTime);
                let endM = Utils.timeToMomentDate(dateM, trainingData.endTime);

                return {
                  id: trainingData.training.id,
                  title: trainingData.training.title + ' - ' + trainingGenericFound.description,
                  allDay: true,
                  start: startM,
                  end: endM,
                  color: trainingGenericFound.color,
                  textColor: color.isLight() ? '#000' : '#FFF'
                }
              });
          }
        });
    }
  },

  reportUserList(req, res) {
    if (req.query.id) {
      var id = req.query.id;
      var dateSelected = req.query.dateSelected;

      if (!dateSelected) return res.badRequest('Data do treinamento não selecionada.');

      Training.findOne(id)
        .populate('company')
        .populate('users')
        .populate('teams')
        .then((training) => {
          training.dateSelected = moment(dateSelected).format('DD/MM/YYYY');

          if (training.useTeam) {
            let teamUsers = [];
            Promise.map(training.teams, function(team) {
                return Team.findOne(team.id)
                  .populate('users')
                  .then((team) => {
                    teamUsers = teamUsers.concat(team.users);
                    return;
                  });
              })
              .then(() => {
                teamUsers = _.uniqBy(teamUsers, 'id');
                returnReport(training, teamUsers, res);
              });
          } else {
            returnReport(training, training.users, res);
          }
        });
    } else {
      res.notFound('Could not find, sorry.');
    }
  },

  reportTrainingCost(req, res) {
    if (req.query.training) {
      console.log('teste');
      var id = req.query.training;

      Training.findOne(id)
        .populate('company')
        .populate('budget')
        .populate('institution')
        .populate('trainingDates')
        .then((training) => {
          if (!training) return res.badRequest({
            message: 'Treinamento não encontrado'
          });
          if (!training.budget) return res.badRequest({
            message: 'Não foi informado o Cód. do Orçamento no Treinamento'
          });
          if (!training.company) return res.badRequest({
            message: 'O treinamento não pertence a nenhum estabelecimento'
          });
          if (!training.institution) return res.badRequest({
            message: 'O treinamento não pertence a nenhuma instituição'
          });
          let trainings = [];

          training.title = training.id + ' - ' + training.title;
          training.expirationDate = moment(training.expirationDate).format('DD/MM/YYYY');
          training.instituitionName = training.institution.name;
          training.budgetName = training.budget.id + ' - ' + training.budget.description;

          let dateThisTraining = _.sortBy(training.trainingDates, 'date');
          if (dateThisTraining.length) {
            training.initialDate = moment(_.first(dateThisTraining).date).format('DD/MM/YYYY');
            training.conclusionDate = moment(_.last(dateThisTraining).date).format('DD/MM/YYYY');
          }

          trainings.push(training);

          if (trainings.length && training.budget) {
            var report = ReportService.jasper.export({
              report: 'trainingCost',
              data: {
                training: training.title,
                initialDate: "Indefinido",
                conclusionDate: "",
                companyName: training.company.id + ' - ' + training.company.name,
                companyCnpj: training.company.cnpj,
                companyAddress: training.company.address
              },
              dataset: trainings
            }, 'pdf');

            Utils.setPdfHeader(res, report.length);

            res.send(report);
          } else {
            res.status(204).send();
          }
        });

    } else {
      var start = moment(req.query.start, 'YYYY-MM-DD').toDate();
      var end = moment(req.query.end, 'YYYY-MM-DD').toDate();

      return TrainingDate.find({
          company: req.user.company,
          date: {
            '>=': start,
            '<=': end
          }
        })
        .then((trainingDates) => {
          if (!trainingDates.length) return res.status(204).send();

          var trainingIds = _.map(_.uniqBy(trainingDates, 'training'), 'training');

          return Training.find(trainingIds)
            .populate('company')
            .populate('budget')
            .populate('institution')
            .then((trainings) => {
              trainings = _.map(trainings, (training) => {
                if (!training ||
                  !training.budget ||
                  !training.company ||
                  !training.institution) return;

                training.title = training.id + ' - ' + training.title;
                training.expirationDate = moment(training.expirationDate).format('DD/MM/YYYY');
                training.instituitionName = training.institution.name;
                training.budgetName = training.budget.id + ' - ' + training.budget.description;

                let dateThisTraining = _.sortBy(_.filter(trainingDates, {
                  training: training.id
                }), 'date');
                if (dateThisTraining.length) {
                  training.initialDate = moment(_.first(dateThisTraining).date).format('DD/MM/YYYY');
                  training.conclusionDate = moment(_.last(dateThisTraining).date).format('DD/MM/YYYY');
                }
                return training;
              });

              trainings = _.compact(trainings);

              if (!trainings.length) return res.badRequest('Não há dados para gerar o relatório.');
              // console.log(trainings[0]);
              var report = ReportService.jasper.export({
                report: 'trainingCost',
                data: {
                  training: "Indefinido",
                  initialDate: moment(start, "YYYY-MM-DD").format("DD/MM/YYYY") + " até ",
                  conclusionDate: moment(end, "YYYY-MM-DD").format("DD/MM/YYYY"),
                  companyName: trainings[0].company.id + ' - ' + trainings[0].company.name,
                  companyCnpj: trainings[0].company.cnpj,
                  companyAddress: trainings[0].company.address
                },
                dataset: trainings
              }, 'pdf');

              Utils.setPdfHeader(res, report.length);
              res.send(report);
            });
        })
        .catch(res.badRequest);
    }
  },

  reportTrainingPending(req, res) {
    let ids = req.query.users ? req.query.users.split(',') : null;
    let teamIds = req.query.teams ? req.query.teams.split(',').map(Number) : null;
    let startDate = req.query.startDate;
    let endDate = req.query.endDate;

    let reportData = [];

    if (startDate && endDate) {
      return TrainingDate
        .find({
          company: req.user.company,
          date: {
            '>=': startDate,
            '<=': endDate
          }
        })
        .then((trainingDatesFound) => {
          let trainingIds = _.uniq(_.map(trainingDatesFound, 'training'));
          return Training
            .find({
              id: trainingIds,
              finished: false
            })
            .populate('users')
            .populate('teams')
            .populate('company')
            .then((trainingsFound) => {
              let trainings = [];

              return Promise.map(trainingsFound, (training) => {
                  training = training.toJSON();
                  let datesOfThisTraining = _.filter(trainingDatesFound, {
                    training: training.id
                  });
                  datesOfThisTraining = _.sortBy(datesOfThisTraining, 'date');

                  training.title = training.id + ' - ' + training.title;
                  training.initialDate = moment(_.first(datesOfThisTraining).date).format('DD/MM/YYYY');
                  training.conclusionDate = moment(_.last(datesOfThisTraining).date).format('DD/MM/YYYY');

                  if (training.useTeam) {
                    let users = [];
                    return Team
                      .find(_.map(training.teams, 'id'))
                      .populate('users')
                      .then((teams) => {
                        teams.forEach((team) => {
                          users = users.concat(team.users);
                        });

                        training.users = _.map(users, (user) => {
                          user.firstName = user.id + ' - ' + user.firstName;
                          user.cpf = Utils.maskText(user.cpf, '___.___.___-__');
                          return user;
                        });

                        return training;
                      });
                  } else {
                    training.users = _.map(training.users, (user) => {
                      user.firstName = user.id + ' - ' + user.firstName;
                      user.cpf = Utils.maskText(user.cpf, '___.___.___-__');
                      return user;
                    });
                  }

                  return training;
                })
                .then((trainingsFound) => {
                  trainings.push(trainingsFound);
                  returnReportTrainingPending(trainingsFound[0], trainingsFound, res);
                });
            });
        });
    } else {
      return Training
        .find({
          company: req.user.company,
          finished: false
        })
        .populate('teams')
        .populate('users')
        .populate('budget')
        .populate('trainingDates')
        .populate('company')
        .then((trainingsFound) => {
          return Promise.each(trainingsFound, (training) => {
              let trainingDates = _.sortBy(training.trainingDates, 'date');
              if (!trainingDates.length) return;

              training.title = training.id + ' - ' + training.title;
              training.initialDate = moment(_.first(trainingDates).date).format('DD/MM/YYYY');
              training.conclusionDate = moment(_.last(trainingDates).date).format('DD/MM/YYYY');

              let duration = Utils.parseTrainingDuration(training.duration);
              training.duration = `${duration.h}h${duration.m}`;
              training.minutesDuration = (duration.h * 60) + duration.m;

              if (training.useTeam) {
                let filterTeam = _.map(training.teams, 'id');
                if (teamIds) {
                  filterTeam = _.intersection(teamIds, filterTeam);
                };

                return Team
                  .find(filterTeam)
                  .populate('users')
                  .then((teamsFound) => {
                    teamsFound.forEach((team) => {
                      let usersToFilter = team.users;
                      if (ids) {
                        usersToFilter = _.filter(team.users, (user) => {
                          return _.includes(ids, user.id.toString());
                        });
                      }

                      usersToFilter.forEach((user) => {
                        __buildReport(user, training);
                      });
                    });
                    return;
                  });
              } else {
                if (teamIds) return;

                let usersToFilter = training.users;
                if (ids) {
                  usersToFilter = _.filter(training.users, (user) => {
                    return _.includes(ids, user.id.toString());
                  });
                }

                usersToFilter.forEach((user) => {
                  __buildReport(user, training);
                });

                return;
              }
            })
            .then(() => {
              if (!reportData.length) return res.status(204).send();

              let durationTotal = '00h00';
              let minutesTotal = 0;

              reportData.forEach((data)=> {
                minutesTotal += _.sumBy(data.trainingsUsers, 'minutesDuration');
              });

              if (minutesTotal) {
                let hoursTotal = parseInt(minutesTotal / 60);
                minutesTotal = minutesTotal % 60;

                durationTotal = `${hoursTotal}h${minutesTotal}`;
              }

              reportData = _.sortBy(reportData, 'id');
              var report = ReportService.jasper.export({
                report: 'pendingTraining',
                data: {
                  training: "Indefinido",
                  hoursTotal: durationTotal,
                  companyName: reportData[0].company.id + ' - ' + reportData[0].company.name
                },
                dataset: reportData
              }, 'pdf');

              Utils.setPdfHeader(res, report.length);

              res.send(report);
            });
        })
        .catch(res.badRequest);
    }

    function __buildReport(user, training) {
      let indexFound = _.findIndex(reportData, {
        id: user.id
      });

      if (indexFound < 0) {
        user = user.toJSON();
        user.cpf = Utils.maskText(user.cpf, '___.___.___-__');
        user.company = training.company;

        user.trainingsUsers = [training];
        reportData.push(user);
      } else {
        if (!reportData[indexFound]) return;
        reportData[indexFound].trainingsUsers.push(training);
      }
    }
  },

  reportTrainingAvaliation(req, res) {
    if (req.query.id) {
      Training.findOne(req.query.id)
        .populate('company')
        .populate('trainingGeneric')
        .then((training) => {
          TrainingAvaliationNote.find({
            training: training.id
          }).then((avaliations) => {
            trainings = []
            training['avaliations'] = avaliations;
            training.initialDate = moment(training.initialDate).format('DD/MM/YYYY');
            training.conclusionDate = moment(training.conclusionDate).format('DD/MM/YYYY');
            trainings.push(training);

            if (avaliations.length) {
              var report = ReportService.jasper.export({
                report: 'trainingAvaliation',
                data: {
                  title: training.title + " " + training.trainingGeneric.description,
                  companyName: training.company.id + ' - ' + training.company.name,
                  companyCnpj: training.company.cnpj,
                  companyAddress: training.company.address,
                },
                dataset: trainings
              }, 'pdf');

              Utils.setPdfHeader(res, report.length);

              res.send(report);
            } else {
              res.status(204).send();
            }
          })
        });
    } else {
      res.status(204).send();
    }
  },

  reportTrainersAvaliation(req, res) {
    if (req.query.id) {
      User.findOne(req.query.id)
        .populate('company')
        .populate('trainingsTrainers')
        .then((user) => {

          Promise.map(user.trainingsTrainers, (trainingTrainers) => {
            return Training.findOne(trainingTrainers.id)
              .then((training) => {

                return TrainingTrainersNote.find({
                  training: training.id,
                  trainer: user.id
                }).then((avaliations) => {
                  training['avaliations'] = avaliations;
                  training.initialDate = moment(training.initialDate).format('DD/MM/YYYY');
                  training.conclusionDate = moment(training.conclusionDate).format('DD/MM/YYYY');
                  return training;
                })

              })
          }).then((trainings) => {
            if (trainings.length) {
              var report = ReportService.jasper.export({
                report: 'trainersAvaliation',
                data: {
                  name: user.firstName + " " + user.lastName,
                  companyName: user.company.id + ' - ' + user.company.name,
                  companyCnpj: user.company.cnpj,
                  companyAddress: user.company.address,
                },
                dataset: trainings
              }, 'pdf');

              Utils.setPdfHeader(res, report.length);

              res.send(report);
            } else {
              res.status(204).send();
            }
          });
        });
    } else {
      res.status(204).send();
    }
  },

  reportInstitutionAvaliation(req, res) {
    if (req.query.id) {
      Training.find({
          institution: req.query.id
        })
        .populate('company')
        .populate('institution')
        .populate('trainingGeneric')
        .then((trainings) => {

          Promise.map(trainings, (training) => {
            return TrainingInstitutionNote.find({
              training: training.id
            }).then((avaliations) => {
              training['avaliations'] = avaliations;
              training.initialDate = moment(training.initialDate).format('DD/MM/YYYY');
              training.conclusionDate = moment(training.conclusionDate).format('DD/MM/YYYY');
              return training;
            });

          }).then((trainings) => {
            if (trainings.length) {
              var report = ReportService.jasper.export({
                report: 'institutionAvaliation',
                data: {
                  institution: trainings[0].institution.name,
                  companyName: trainings[0].company.id + ' - ' + trainings[0].company.name,
                  companyCnpj: trainings[0].company.cnpj,
                  companyAddress: trainings[0].company.address,
                },
                dataset: trainings
              }, 'pdf');

              Utils.setPdfHeader(res, report.length);

              res.send(report);
            } else {
              res.status(204).send();
            }
          })
        });
    } else {
      res.status(204).send();
    }
  },

  reportUserTraining(req, res) {
    let ids = req.query.users ? req.query.users.split(',') : null;
    let teamIds = req.query.teams ? req.query.teams.split(',').map(Number) : null;
    let trainings = req.query.trainings ? req.query.trainings.split(',') : null;
    let startDate = req.query.startDate;
    let endDate = req.query.endDate;
    let finished = req.query.finished;

    let query = { company: req.user.company };
    if (finished != '2') {
      query.finished = finished;
    }

    let queryDate = {
      company: req.user.company,
      date: {
        '>=': startDate,
        '<=': endDate
      }
    };

    if (trainings) {
      queryDate.training = trainings;
    }

    let reportData = [];

    return TrainingDate.find(queryDate).then((trainingDatesFound) => {
      let trainingIds = _.uniq(_.map(trainingDatesFound, 'training'));
      query.id = trainingIds;
      return Training.find(query)
        .populate('teams')
        .populate('users')
        .populate('trainingDates')
        .populate('company')
        .populate('budget')
        .then((trainingsFound) => {

          return Promise.each(trainingsFound, (training) => {
              let trainingDates = _.sortBy(training.trainingDates, 'date');
              if (!trainingDates.length) return;

              training.title = training.id + ' - ' + training.title;
              training.initialDate = moment(_.first(trainingDates).date).format('DD/MM/YYYY');
              training.conclusionDate = moment(_.last(trainingDates).date).format('DD/MM/YYYY');

              let duration = Utils.parseTrainingDuration(training.duration);
              training.duration = `${duration.h}h${duration.m}`;
              training.minutesDuration = (duration.h * 60) + duration.m;

              if (training.useTeam) {
                let filterTeam = _.map(training.teams, 'id');
                if (teamIds) {
                  filterTeam = _.intersection(teamIds, filterTeam);
                };

                return Team
                  .find(filterTeam)
                  .populate('users')
                  .then((teamsFound) => {
                    teamsFound.forEach((team) => {
                      let usersToFilter = team.users;
                      if (ids) {
                        usersToFilter = _.filter(team.users, (user) => {
                          return _.includes(ids, user.id.toString());
                        });
                      }

                      usersToFilter.forEach((user) => {
                        __buildReport(user, training);
                      });
                    });
                    return;
                  });
              } else {
                if (teamIds) return;

                let usersToFilter = training.users;
                if (ids) {
                  usersToFilter = _.filter(training.users, (user) => {
                    return _.includes(ids, user.id.toString());
                  });
                }

                usersToFilter.forEach((user) => {
                  __buildReport(user, training);
                });

                return;
              }
            })
            .then(() => {
              if (!reportData.length) return res.status(204).send();

              let durationTotal = '00h00';
              let minutesTotal = 0;

              reportData.forEach((data)=> {
                minutesTotal += _.sumBy(data.trainingsUsers, 'minutesDuration');
              });

              if (minutesTotal) {
                let hoursTotal = parseInt(minutesTotal / 60);
                minutesTotal = minutesTotal % 60;

                durationTotal = `${hoursTotal}h${minutesTotal}`;
              }

              reportData = _.sortBy(reportData, 'id');
              var report = ReportService.jasper.export({
                report: 'pendingTraining',
                data: {
                  training: "Indefinido",
                  hoursTotal: durationTotal,
                  companyName: reportData[0].company.id + ' - ' + reportData[0].company.name
                },
                dataset: reportData
              }, 'pdf');

              Utils.setPdfHeader(res, report.length);

              res.send(report);
            });
        })
        .catch(res.badRequest);

      function __buildReport(user, training) {
        let indexFound = _.findIndex(reportData, {
          id: user.id
        });

        if (indexFound < 0) {
          user = user.toJSON();
          user.cpf = Utils.maskText(user.cpf, '___.___.___-__');
          user.company = training.company;

          user.trainingsUsers = [training];
          reportData.push(user);
        } else {
          if (!reportData[indexFound]) return;
          reportData[indexFound].trainingsUsers.push(training);
        }
      }
    });
  },

  reportTraining(req, res) {
    let ids = req.query.trainings ? req.query.trainings.split(',') : null;
    let finished = req.query.finished;
    let startDate = req.query.startDate;
    let endDate = req.query.endDate;

    let query = { company: req.user.company };
    if (finished != '2') {
      query.finished = finished;
    }

    let queryDate = {
      company: req.user.company,
      date: {
        '>=': startDate,
        '<=': endDate
      }
    };

    if (ids) {
      queryDate.training = ids;
    }

    return TrainingDate.find(queryDate)
      .then(trainingDates => {
        let trainingIds = _.uniq(_.map(trainingDates, 'training'));
        query.id = trainingIds;
        return Training.find(query)
          .populate('company')
          .populate('budget')
          .populate('trainingDates')
          .then(trainings => {
            let minutesTotal = 0;

            Promise.map(trainings, (training) => {
              if (!training) return;

              const first = _.first(training.trainingDates);
              const last = _.last(training.trainingDates);

              training.startDate = moment(first.date).format('DD/MM/YYYY');
              training.endDate = moment(last.date).format('DD/MM/YYYY');

              let duration = Utils.parseTrainingDuration(training.duration);
              training.duration = `${duration.h}h${duration.m}`;

              minutesTotal += duration.h * 60;
              minutesTotal += duration.m;

              return training;
            }).then((trainingsFound) => {
              if (!trainingsFound.length || !_.first(trainingsFound)) {
                return res.status(204).send();
              }

              let durationTotal = '00h00';

              if (minutesTotal) {
                let hoursTotal = parseInt(minutesTotal / 60);
                minutesTotal = minutesTotal % 60;

                durationTotal = `${hoursTotal}h${minutesTotal}`;
              }

              trainingsFound = _.sortBy(trainingsFound, 'id');
              var report = ReportService.jasper.export({
                report: 'training',
                data: {
                  companyName: trainingsFound[0].company.name,
                  hoursTotal: durationTotal.toString()
                },
                dataset: trainingsFound
              }, 'pdf');

              Utils.setPdfHeader(res, report.length);

              return res.send(report);
            }).catch(res.badRequest);
          });

      });
  },

  closedTraining: function(req, res) {
    const date = req.body.date;
    const note = req.body.note;
    const hour = req.body.hour;

    // const frequency = req.body.frequency;
    const instructor = req.body.instructor;
    const user = req.body.user;
    const training = req.body.training;

    return TrainingNote.create({
      company: req.company,
      training: training,
      user: user,
      note: note,
      date: date
    }).exec(function(err, trainingNote) {
      if (err) {
        return res.serverError(err);
      }

      const startTime = moment(date).format('HH:mm');
      const endTime = moment(date).add(hour, 'H').format('HH:mm');
      console.log(startTime);
      console.log(endTime);
      return TrainingDate.create({
        date: date,
        startTime: startTime,
        endTime: endTime,
        company: req.company,
        training: training
      }).exec(function(err, trainingDate) {
        if (err) {
          return res.serverError(err);
        }

        return TrainingPresence.create({
          company: req.company,
          training: training,
          user: user,
          presence: true,
          trainingDate: trainingDate.id,
          date: date
        }).exec(function(err, trainingPresence) {
          if (err) {
            return res.serverError(err);
          }

          return Training.findOne(training).populate('trainers').exec(
            function(err, training) {
              training.finished = true;
              training.trainers.add(instructor);

              return training.save(function(err) {
                if (err) {
                  return res.serverError(err);
                }

                return res.ok({
                  trainingNote: trainingNote,
                  trainingDate: trainingDate,
                  trainingPresence: trainingPresence,
                  training: training
                });
              });
            }
          );
        });
      });
    });
  },

};

function returnReport(training, users, res) {
  if (users.length) {
    users = _.map(users, (user) => {
      user.cpf = Utils.maskText(user.cpf, '___.___.___-__');
      return user;
    });

    var report = ReportService.jasper.export({
      report: 'userList',
      data: {
        training: training.id + ' - ' + training.title,
        dateSelected: training.dateSelected,
        companyName: training.company.id + ' - ' + training.company.name,
        companyCnpj: training.company.cnpj,
        companyAddress: training.company.address,
        companyCityName: training.company.city.name
      },
      dataset: users
    }, 'pdf');

    Utils.setPdfHeader(res, report.length);

    res.send(report);
  } else {
    res.status(204).send();
  }
}

function returnReportTrainingPending(training, trainings, res) {
  _.remove(trainings, (obj) => {
    return obj.users.length ? false : true;
  });

  if (trainings.length) {
    var report = ReportService.jasper.export({
      report: 'padingTrainingByTraining',
      data: {
        training: trainings,
        users: 'Indefinidos',
        companyName: trainings[0].company.id + ' - ' + trainings[0].company.name,
        companyCnpj: trainings[0].company.cnpj,
        companyAddress: trainings[0].company.address
      },
      dataset: trainings
    }, 'pdf');

    Utils.setPdfHeader(res, report.length);

    res.send(report);
  } else {
    res.status(204).send();
  }
}
