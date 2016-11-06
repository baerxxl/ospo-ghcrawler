const config = require('painless-config');
const serviceBusQueue = require('./lib/servicebuscrawlqueue');
const inmemoryQueue = require('./lib/inmemorycrawlqueue');
const InmemoryDocStore = require('./lib/inmemoryDocStore');
const MongoDocStore = require('./lib/mongodocstore');
const requestor = require('ghrequestor');
const webhookDriver = require('ghcrawler').webhookDriver;
const finder = require('ghcrawler').eventFinder;

// Setup the event trigger mechanism to read off a service bus topic and format
// the events as { type: type, qualifier: qualifier } if they are relevant
const repoEvents = new Set(['issues', 'issue_comment', 'push', 'status']);
const orgEvents = new Set(['membership']);
const formatter = message => {
  const realMessage = message[0];
  const type = realMessage.customProperties.event;
  const event = JSON.parse(realMessage.body);
  let qualifier = null;
  if (repoEvents.has(type)) {
    qualifier = event.repository.full_name.toLowercase();
  } else if (orgEvents.has(type)) {
    qualifier = event.organization.login.toLowercase();
  }
  return qualifier ? { type: type, qualifier: qualifier } : null;
};
const serviceBusUrl = config.get('GHCRAWLER_EVENT_BUS_URL');
const eventTrigger = new serviceBusQueue(serviceBusUrl, 'webhookevents', 'ghcrawlerdev', formatter);

// Create the github requestor to use and preconfigure with needed secrets etc.
const requestorInstance = new requestor({
  headers: {
    authorization: `token ${config.get('GHCRAWLER_GITHUB_TOKEN')}`
  }
});

// Connect to the underlying doc store and then fire up the watcher. If no mongo store URL
// is available, use an in-memory store.
// const mongoUrl = config.get('GHCRAWLER_MONGO_URL');
const mongoUrl = null;
const store = mongoUrl ? new MongoDocStore(mongoUrl) : new InmemoryDocStore();
store.connect().then(() => {
  const eventFinder = new finder(requestorInstance, store);
  const eventSink = new inmemoryQueue();
  webhookDriver.watch(eventTrigger, eventFinder, eventSink);
});
