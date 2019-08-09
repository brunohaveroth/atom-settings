/**
* Service: ReportService
* Contém métodos de todos os relatórios do sistema
**/

var jasper = require('node-jasper')({
  path: sails.config.jasper.path,
  reports: sails.config.jasper.reports
});

const moment = require('moment');
const Promise = require('bluebird');
const _ = require('lodash');

module.exports = {
	/**
	* Método: faultsAndFrequency
	* Relatórios de faltas e frequencia **/
	faultsAndFrequency(filters, sessionUser, res) {
    return Training
    .findOne({ id: parseInt(filters.training) })
    .populate('company')
    .populate('users')
    .populate('trainingDates')
    .then((trainingFound)=> {
      if (!trainingFound) return res.badRequest('Treinamento não encontrado.');

      if (filters.users && filters.users.length) {
        trainingFound.usersPopulated = __filterUsers(trainingFound.users);
      } else {
        trainingFound.usersPopulated = trainingFound.users;
      }

      return trainingFound;

      function __filterUsers(users) {
        return _.filter(users, (user)=> {
          return _.includes(filters.users, user.id.toString());
        });
      }
    })
    .then((training)=> {
      // Filtra as datas de treinamento que ja passaram.
      if (filters.startDate && filters.endDate) {
        let startDate = moment(filters.startDate, 'DD/MM/YYYY');
        let endDate = moment(filters.endDate, 'DD/MM/YYYY');
        training.trainingDates = _.filter(training.trainingDates, (trainingDate)=> {
          let date = moment(trainingDate.endDate);

          return (date.isAfter(startDate) && date.isBefore(endDate)) ? true:false;
        });
      } else {
        let currentM = moment();
        training.trainingDates = _.filter(training.trainingDates, (trainingDate)=> {
          let endTimeDate = moment(moment(trainingDate.date).format('YYYY-MM-DD') + ' ' + trainingDate.endTime, 'YYYY-MM-DD HH:mm');
          return currentM.isBefore(endTimeDate) ? false:true;
        });
      }

      // Calcula a duração do treinamento em minutos e a duração de cada trainingDate.
      let totalMinutesDuration = 0;
      training.trainingDates = _.map(training.trainingDates, (trainingDate)=> {

        let startTrainingM = moment(trainingDate.startDate);
        let endTrainingM = moment(trainingDate.endDate);

        let minutesDuration = endTrainingM.diff(startTrainingM, 'minutes');

        totalMinutesDuration += minutesDuration;
        trainingDate.minutesDuration = minutesDuration;

        return trainingDate;
      });

      training.totalMinutesDuration = totalMinutesDuration;
      training.totalHoursDuration = (totalMinutesDuration/60).toFixed(1);

      return training;
    })
    .then((training)=> {
      // Popula o training com todas as notas e presenças do mesmo.
      return TrainingPresence.find({ training: training.id })
      .then((presencesFound)=> {
        training.presencesPopulated = presencesFound;
        return training;
      });
    })
    .then((training)=> {
      // Processa os dados do relatório
      let reportData = _.map(training.usersPopulated, (user)=> {
        let raw = {};

        raw.id = user.id;
        raw.userName = user.id + ' - ' + user.firstName + ' ' + user.lastName;
        raw.faults = __processUserFaults(training, user.id);
        raw.frequency = __processUserFrequency(training, user.id);
        raw.minFrequency = training.frequency;
        raw.totalHoursDuration = training.totalHoursDuration;

        return raw;
      });

      reportData = _.sortBy(reportData, 'userName');

      if (reportData.length) {
        let params = {};

        params.training =  training.id + ' - ' + training.title;
        params.companyName =  training.company.id + ' - ' + training.company.name;

        if (filters.startDate && filters.endDate) {
          params.rangeDate = filters.startDate + ' à ' + filters.endDate;
        }

        let report = ReportService.jasper.export({
          report: 'faultsAndFrequency',
          data: params,
          dataset: reportData
        }, 'pdf');

        Utils.setPdfHeader(res, report.length);
        res.send(report);
      } else {
        res.status(204).send();
      }

      return;

      function __processUserFaults(training, userId) {
        // Calcula as faltas do participante.
        let minutesFaults = 0;
        training.trainingDates.forEach((trainingDate)=> {
          let isPresent = _.find(training.presencesPopulated, {
            trainingDate: trainingDate.id,
            user: userId,
            presence: true
          });

          minutesFaults += isPresent ? 0:trainingDate.minutesDuration;
        });

        return minutesFaults ? (minutesFaults/60).toFixed(1) : 0;
      }

      function __processUserFrequency(training, userId) {
        // Calcula quantos % de frequecia o participante tem do treinamento.
        let trainingMinutesDuration = training.totalMinutesDuration;
        let minutesPresent = 0;

        training.trainingDates.forEach((trainingDate)=> {
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
    });
  },

  /**
	* Método: noteAndFrequency
	* Relatórios de notas e frequencia **/
  async noteAndFrequency(filters, sessionUser, res) {
    try {
      let userIds = filters.users ? filters.users.map(Number) : [];
      let userFilter = userIds.length ? { id: userIds } : {};

      let training = await Training
        .findOne({ id: parseInt(filters.training) })
        .populate('users', userFilter)
        .populate('company')
        .populate('trainingDates');

      let participantsStatus = await Training.participantsStatus(training);
      let totalHoursDuration = Utils.formatMinutes(participantsStatus.minutesDuration, 'h');

      let reportData = _.map(participantsStatus.participants, (participant)=> {
        let raw = {};

        raw.id = participant.userId;
        raw.userName = participant.userId + ' - ' + participant.firstName + ' ' + participant.lastName;
        raw.note = participant.note;
        raw.frequency = participant.frequency;
        raw.status = participant.status;
        raw.minFrequency = participantsStatus.frequency;
        raw.minNote = participantsStatus.note;
        raw.totalHoursDuration = totalHoursDuration;

        return raw;
      });

      reportData = _.sortBy(reportData, 'userName');

      if (reportData.length) {
        let report = ReportService.jasper.export({
          report: 'noteAndFrequency',
          data: {
            training: training.id + ' - ' + training.title,
            companyName: training.company.id + ' - ' + training.company.name
          },
          dataset: reportData
        }, 'pdf');

        Utils.setPdfHeader(res, report.length);
        res.send(report);
      } else {
        res.status(204).send();
      }

      return;
    } catch (e) {
      return Promise.reject(e);
    }
  },

  /**
	* Método: partnercompanyByUser
	* Relatórios de Alunos por Empresas parceiras **/
  async partnercompanyByUser(filters, sessionUser, res) {
    try {
      let reportData = [];
      let query = { company: sessionUser.company };

      if (filters.partnerCompany) {
        query.partnerCompany = Number(filters.partnerCompany);
      }

      // Busca os registros de alunos que estão trabalhando em empresas parceiras
      let worksInPartnerCompany = await WorksInInstitutePartnerCompany
      .find(query)
      .populate('user')
      .populate('partnerCompany');

      let findCurentTraining = function(userId) {
        return new Promise((resolve, reject)=> {
          let sql = `SELECT training.id FROM training
              LEFT JOIN usersparticipantontraining ON usersparticipantontraining.training = training.id
            WHERE usersparticipantontraining.user = ${userId}
            AND (training.finished IS NULL OR training.finished = false)`;

          return MySQL.query(sql).then((raw)=> {
            return resolve({
              userId,
              training: raw[0] ? raw[0].id : null
            });
          }).catch(reject);
        });
      };

      let allUsers = _.unique(_.map(worksInPartnerCompany, 'user'), 'id');

      // Busca o treinamento que o aluno está cursando no momento
      let currentUserTrainingsP = allUsers.map((user)=> {
        return findCurentTraining(user.id);
      });

      let currentUserTrainingIds = await Promise.all(currentUserTrainingsP);

      let groupedByPartnerCompany = _.groupBy(worksInPartnerCompany, 'partnerCompany.id');
      groupedByPartnerCompany = Object.keys(groupedByPartnerCompany).map(key => ({ partnerCompany: key, items: groupedByPartnerCompany[key] }));

      // Percorre as empresas parceiras encontradas
      await Promise.each(groupedByPartnerCompany, (group)=> {
        let reportRow = {};
        let partnerCompany = group.items[0].partnerCompany;

        reportRow.name = partnerCompany.name;
        reportRow.users = [];

        // para cada empresa parceira, processa os alunos que trabalham na mesma e estão em um treinamento.
        return Promise.each(group.items, async (partnerCompanyUser)=> {
          if (filters.user && Number(filters.user) !== partnerCompanyUser.user.id) return;

          let currentUserTraining = _.find(currentUserTrainingIds, { userId: partnerCompanyUser.user.id });
          if (!currentUserTraining) return;

          let reportUserRow = {};

          reportUserRow.firstName = partnerCompanyUser.user.firstName;
          reportUserRow.lastName = partnerCompanyUser.user.lastName;

          if (currentUserTraining.training) {
            let participantStatus = await Training.participantsStatus(currentUserTraining.training, partnerCompanyUser.user.id);

            reportUserRow.frequency = participantStatus.participant.frequency;
            reportRow.users.push(reportUserRow);
          }
        })
        .then(()=> {
          if (reportRow.users.length) {
            reportData.push(reportRow);
          }
        });
      });

      if (!reportData.length) return Promise.reject('Não há dados para exibir.');

      let data = await JSReportService.render('BJsHvkTVm', {
        header: {
          company:  sessionUser.companyPopulated
        },
        data: reportData
      });

      Utils.setPdfHeader(res, data.length);

      res.send(data);
      return;
    } catch (e) {
      return Promise.reject(e);
    }
  },

  /**
	* Método: absenteeism
	* Relatórios de Absenteísmo dos treinamentos **/
  async absenteeism(filters, sessionUser, res) {
    try {
      let groupBy = filters.groupBy;
      let reportData = [];

      // Relatório agrupando por treinamentos
      if (groupBy === 'training') {
        let filterTrainingId = filters.trainings ? filters.trainings.map(Number): null;
        if (!filterTrainingId) return Promise.reject('É necessário informar os treinamentos.');

        let trainingQuery = { finished: true, company: sessionUser.company };
        if (filterTrainingId) trainingQuery.id = filterTrainingId;

        let trainings = await Training.find(trainingQuery).populate('users').populate('trainingDates');

        await Promise.each(trainings, (training)=> {
          let reportRow = {
            name: training.id + ' - ' + training.title,
            items: []
          };

          return Training.participantsFrequency(training)
          .then((participantsFrequency)=> {
            participantsFrequency.participants.forEach((participantFrequency)=> {
              let currentUser = participantFrequency.user;

              if (participantFrequency.percent < training.note) {
                reportRow.items.push({
                  name: currentUser.id + ' - ' + currentUser.firstName + ' ' + currentUser.lastName
                });
              }
            });

            if (reportRow.items.length) {
              reportData.push(reportRow);
            }
          });
        });
      } else {
        // Relatório agrupando por usuários
        let filterUserId = filters.users ? filters.users.map(Number): null;
        if (!filterUserId) return Promise.reject('É necessário informar os alunos.');

        let query = `SELECT user.id as user, CONCAT(user.firstName, ' ' ,user.lastName) as name, training.id as training
          FROM usersparticipantontraining usersparticipant
            LEFT JOIN user ON user.id = usersparticipant.user
            LEFT JOIN training ON training.id = usersparticipant.training
          WHERE training.finished = true AND training.company = ${sessionUser.company}
          AND user.id IN (${filterUserId.join(",")})`;

        let findData = await MySQL.query(query);

        let groupedByUser = _.groupBy(findData, 'user');
        groupedByUser = Object.keys(groupedByUser).map(key => ({ id: key, items: groupedByUser[key] }));

        let trainingIds = _.map(findData, 'training');
        let trainings = await Training.find({ id: trainingIds }).populate('trainingDates');

        await Promise.each(groupedByUser, (group)=> {
          let reportRow = {
            name: group.items[0].user + ' - ' + group.items[0].name,
            items: []
          };

          return Promise.each(group.items, (record)=> {
            let training = _.find(trainings, { id: record.training });
            training.participants = [{ id: Number(group.id) }];

            return Training.participantsFrequency(training)
            .then((frequency)=> {
              let frequencyData = frequency.participants[0];

              if (frequencyData.percent < training.note) {
                reportRow.items.push({
                  name: training.id + ' - ' + training.title
                });
              }
            });
          }).then(()=> {
            if (reportRow.items.length) {
              reportData.push(reportRow);
            }
          });
        });
      }

      if (!reportData.length) return Promise.reject('Não há dados para exibir.');

      let data = await JSReportService.render('rkxHZuJSm', {
        header: {
          company: sessionUser.companyPopulated
        },
        data: reportData
      });

      Utils.setPdfHeader(res, data.length);

      res.send(data);
      return;
    } catch (e) {
      return Promise.reject(e);
    }
  },

  async costPerParticipant(filters, sessionUser, res) {
    try {
      let userIds = filters.users ? filters.users.map(Number) : [];
      if (!userIds.length) return res.badRequest('É necessário informar pelo menos um usuário.');

      let findTrainings = ()=> {
        let q = `SELECT training.id, training.title as trainingName, budget.description AS budgetName,
          budget.totalValue AS expected, usersParticipant.user,
          (SELECT COUNT(0) FROM usersparticipantontraining WHERE usersparticipantontraining.training = training.id) as qtdParticipants,
          SUM(trainingcost.value) AS spent FROM training
            LEFT JOIN budget ON training.budget = budget.id
            LEFT JOIN trainingcost ON trainingcost.training = training.id
            LEFT JOIN usersparticipantontraining usersParticipant ON usersParticipant.training = training.id
          WHERE
            training.company = ${sessionUser.company} AND
            training.finished = 1 AND
            usersParticipant.user in (${userIds.join(',')})
          GROUP BY training.id, budgetName, user`;

        return MySQL.query(q);
      };

      let [ users, trainings ] = await Promise.all([
        User.find({ id: userIds, company: sessionUser.company }),
        findTrainings()
      ]);

      let header = {
        company: sessionUser.companyPopulated
      };

      let data = [];

      users.forEach((user)=> {
        let reportRow = {};
        let userTrainings = _.filter(trainings, { user: user.id });

        reportRow.name = user.firstName + ' ' + user.lastName;

        reportRow.userTrainings = userTrainings.map((userTraining)=> {
          userTraining.expected = userTraining.expected / userTraining.qtdParticipants;
          userTraining.spent = userTraining.spent / userTraining.qtdParticipants;

          userTraining.expectedValue = Utils.numberToReal(userTraining.expected);
          userTraining.spentValue = Utils.numberToReal(userTraining.spent);
          return userTraining;
        });

        reportRow.totalExpected = Utils.numberToReal(_.sum(reportRow.userTrainings, 'expected'));
        reportRow.totalSpent = Utils.numberToReal(_.sum(reportRow.userTrainings, 'spent'));

        data.push(reportRow);
      });

      if (!data.length) return Promise.reject('Não há dados para exibir.');

      let report = await JSReportService.render('H1yFzFDh7', { header, data });
      Utils.setPdfHeader(res, report.length);
      res.send(report);

      return;
    } catch (e) {
      return Promise.reject(e);
    }
  },

  async partnerCompanyApprentices(filters, sessionUser, res) {
    try {
      let company = sessionUser.company;
      let partnerCompanyId = filters.partnerCompany;
      if (!partnerCompanyId) { return res.badRequest('É necessário informar uma empresa parceira.'); }

      let [partnerCompany, usersWorkingOnPartnerCompany] = await Promise.all([
        InstitutePartnerCompany.findOne({ company, id: partnerCompanyId }),
        WorksInInstitutePartnerCompany.find({ company, partnerCompany: partnerCompanyId }).populate('user')
      ]);

      if (!partnerCompany) { return res.notFound(); }

      let users = _.map(usersWorkingOnPartnerCompany, 'user');
      let usersIds = _.map(users, 'id');

      let usersParticipants = await UsersParticipantOnTraining.find({ user: usersIds });
      let trainings = await Training.find({
        select: ['id', 'title']
      }).where({
        id: _.map(usersParticipants, 'training')
      });

      let userMetas = await UserMeta.find({
        company,
        user: usersIds,
        or: [
          {key: 'youngApprentice'},
          {key: 'teenagerApprentice'}
        ]
      });

      let allTrainingIds = _.map(usersParticipants, 'training');

      let participantsStatus = await Promise.map(allTrainingIds, (trainingId)=> {
        return Training.participantsStatus(trainingId);
      });

      _.each(users, (user) => {
        let userMetaFiltered = _.filter(userMetas, { 'user': user.id });
        let userMeta = {};

        _.each(userMetaFiltered, (meta) => {
          userMeta[meta.key] = parseInt(meta.value);
        });

        user.userMeta = userMeta;

        let trainingIds = _.filter(usersParticipants, { user: user.id });
        trainingIds = _.map(trainingIds, 'training');

        user.trainings = trainings.filter((t)=> {
          return _.includes(trainingIds, t.id);
        }).map((t)=> {
          let trainingStatus = participantsStatus.find((o)=> o.trainingId === t.id);
          if (!trainingStatus) { return; }

          let participantStatus = trainingStatus.participants.find((o)=> o.userId === user.id);
          console.log('userId', user.id);
          console.log(participantStatus.daysOfAbsences.length);
          console.log('--');
          t.participantStatus = participantStatus;
          return t;
        });
      });

      let youngApprentices = _.filter(users, 'userMeta.youngApprentice');
      let teenagerApprentices = _.filter(users, 'userMeta.teenagerApprentice');
      let totalYoungApprentices = youngApprentices.length;
      let totalTeenagerApprentices = teenagerApprentices.length;
      let total = totalYoungApprentices + totalTeenagerApprentices;
      let header = {
        company: sessionUser.companyPopulated
      };

      let data = {
        partnerCompany,
        youngApprentices,
        teenagerApprentices,
        totalYoungApprentices,
        totalTeenagerApprentices,
        total
      };
      let report = await JSReportService.render('rkYqlg2O4', { header, data });
      Utils.setPdfHeader(res, report.length);
      res.send(report);
      return;
    } catch (e) {
      return Promise.reject(e);
    }
  },

  jasper: jasper

};
