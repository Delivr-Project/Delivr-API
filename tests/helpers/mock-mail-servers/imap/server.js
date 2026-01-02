"use strict";

var Stream = require("stream").Stream;
var util = require("util");
var net = require("net");
var tls = require("tls");
var fs = require("fs");
var imapHandler = require("imap-handler");
//var starttls = require("./starttls");

module.exports = function(options) {
    return new IMAPServer(options);
};

const DEFAULT_TLS_PRIVATE_KEY = Buffer.from([
    '2d2d2d2d2d424547494e205253412050524956415445204b45592d2d2d2d2d0a4d4949457041494241414b4341514541365a',
    '35517168772b6f5766687445694d48453332487439346d7754427041666a743376507058384d37444d43547748730a317863',
    '587651346c51337277726544544f57646f4a6545457937674d78587148306a7730576642782b3849494a5536397873744f79',
    '54374652464476413179540a525859327974394b357336534b6b656e2f65624d666d5a522b30334e4434554673447a6b7a30',
    '466667636a726b586d724d46354568355558582f2b39594865550a786c7030674d41742b2f53756d536d6743617973785a4c',
    '6a4c70643475587a2b582b4a5678736b31414367314e6f454f376c574a432f33574250374d496375320a7756734d64325865',
    '674c54306757596654312f6a7349483634552f6d532f53565843395168784d6c3959666b6f326b78314f6959684478684873',
    '3735524a5a680a724e52786766697767536235304777344e415161444978722f444a50644c68676e70593655514944415141',
    '42416f494241452b74667a57466a4a62674a30716c0a73364f7a733032305368345538545a51756f6e4a34486842624e6269',
    '54746444674e4f62504b31754e6164654e74675735664f654952644b4e3669446a56654e0a4175586851726d71474459565a',
    '3148534755664437347354725a5176526c57504c57747a646879624b36437373343159417950466f396b34624a325a573262',
    '2f0a70344545513857734e6a61396f427074744d5536595955636847786f3167756a4e38686d66446458555178336b355877',
    '78344b4136386476654a3847617349740a642b304a642f46567743797978384854694631464638515a59516541587862584a',
    '674c427543734d514a67686c637042457a576b736342523341703155305a690a346f6174387772505a4743626c614136724e',
    '6b52555662632f2b56773073746e754a2f424c4862507879427336773439357942536a427155575a4d766c6a4e7a0a6d392f',
    '614b30454367594541396f564956416430656e6a53564979415a4e62773131456c69647a6474426b65494a64737871686d58',
    '7a6549465a6242333947640a626a744156636c566271356d4c7349316a32324552327248413459676b6e36766c4c67684b33',
    '5a4d50785a6135376f4a746d4c336f503052764f6a45347a52560a647a4b65784e476f3967552f783953516275794f6d7561',
    '7576415968585a78654c70762b6c4566735a5471717276505547654269455163436759454138706f470a57566e796b577554',
    '6d436530624d6d7659447357704145695a6e464c44614b6353627a334f37524d47625079316379706d7153696e4959557055',
    '5242542f57590a7756504147746a6b755458746431437935386d3750717a6942374e4e574d63734d476a2b6c577254505a36',
    '68434849426341496d4b455070642b593976474a580a6f6174464a67757141474f7a3772696742713669506665514f435770',
    '6d70724e417561682b2b634367594231676379624f543539546e41376d776c73683851660a626d2b74536c6c6e696e324133',
    '593064474a4a4c6d735845504b74485337783247636f74326831643938562f546c57486535574e45556d7831564a62596758',
    '420a707738776a324143786c346f6a4e59715750786567614c6434447052627457365471653965343746546e553768496767',
    '5236516d4641574158492b30396c38790a616d73734e5368716a45396c75355944693642544b774b4267514375496c4b4756',
    '694c66734b6a72595379486e616a4e575078695568496747426634504930540a2f4a673165612f6144796b787630724b486e',
    '77392f3576594749734d3273742f6b52376c356d4d6563672f32516131343548734c664d7074486f315a4f5057460a396763',
    '75747450546567593661714b5068477468495958324d7753444d4d2b58307269366d3071324a74716a636c416a4737794734',
    '436a62744754742f556c450a574d6c535a774b42675144736c47654c556e6b573062735635454733414b525579504b7a2f36',
    '44564e757861495252684f6557564b56313031636c61715841540a77584f70644b72766b6a5a625434417a634e726c477452',
    '6c336c376445565854752b644e372f5a69654a5275377a6153746c41515a6b497950394f33446451330a7249636574517066',
    '724a316341717a364e67307044306d6837377651313357473142426d44466132413942757a4c6f426974756634673d3d0a2d',
    '2d2d2d2d454e44205253412050524956415445204b45592d2d2d2d2d'
    ].join(""),
    "hex"
)
const DEFAULT_TLS_CERT = Buffer.from([
    '2d2d2d2d2d424547494e2043455254494649434154452d2d2d2d2d0a4d494943704443434159774343514375564c564b5654',
    '586e416a414e42676b71686b69473977304241517346414441554d524977454159445651514445776c730a62324e68624768',
    '76633351774868634e4d5455774d6a45794d54457a4d6a55345768634e4d6a55774d6a41354d54457a4d6a5534576a41554d',
    '524977454159440a5651514445776c7362324e686247687663335177676745694d4130474353714753496233445145424151',
    '554141344942447741776767454b416f4942415144700a6e6c4371484436685a2b4730534977635466596533336962424d47',
    '6b422b4f3365382b6c66777a734d774a5041657a58467865394469564465764374344e4d350a5a32676c3451544c75417a46',
    '656f66535044525a384848377767676c547233477930374a50735645554f3844584a4e46646a624b3330726d7a7049715236',
    '66390a3573782b5a6c48375463305068515777504f545051562b42794f755265617377586b53486c5264662f373167643554',
    '47576e534177433337394b365a4b61414a0a724b7a466b754d756c33693566503566346c5847795455414b44553267513775',
    '56596b4c2f6459452f73776879376242577778335a643641745053425a6839500a582b4f7767667268542b5a4c394a56634c',
    '31434845795831682b536a61544855364a6945504745657a766c456c6d4773314847422b4c43424a766e51624467300a4242',
    '6f4d6a4776384d6b3930754743656c6a705241674d42414145774451594a4b6f5a496876634e4151454c4251414467674542',
    '4142586d38475064593073630a6d4d55466c674471467a6365766a6447446365305166626f522b4d375744646d3531324a7a',
    '3253625254675a442f346e61343254684f444f5a7a397a3141634d0a7a4c6778325a4e5a7a5668427a306f644355344a5668',
    '4f43456b732f4f7a53794b6547776a4962344a41593764682b4b6a75312b364d4e66514a347231487a610a53565848302b4a',
    '6c704a44614a37334e51324a796671454c6d4a316d546370746b412f4e36725157686c7a79635442536c666f677766397861',
    '776756504154500a34417577676a486c31324a49324856567331677536355933736c7661485243723042342b4b673147594e',
    '4c4c636246634b2b4e454872486d50787939546e54680a5a77703164734e51552b586b796c7a384955414e57534c48595a4f',
    '4d744e326535534b49647754746c35433859787665755938594b6231674445786e4d7261540a564758514471506c6575673d',
    '0a2d2d2d2d2d454e442043455254494649434154452d2d2d2d2d'
    ].join(""),
    "hex"
);

function IMAPServer(options) {
    Stream.call(this);

    this.options = options || {};
    this.options.credentials = this.options.credentials || {
        key: DEFAULT_TLS_PRIVATE_KEY,
        cert: DEFAULT_TLS_CERT
    };

    if (this.options.secureConnection) {
        this.server = tls.createServer(this.options.credentials, this.createClient.bind(this));
    } else {
        this.server = net.createServer(this.createClient.bind(this));
    }

    this.connectionHandlers = [];
    this.outputHandlers = [];
    this.messageHandlers = [];
    this.fetchHandlers = {};
    this.fetchFilters = [];
    this.searchHandlers = {};
    this.storeHandlers = {};
    this.storeFilters = [];
    this.commandHandlers = {};
    this.capabilities = {};
    this.allowedStatus = ["MESSAGES", "RECENT", "UIDNEXT", "UIDVALIDITY", "UNSEEN"];
    this.literalPlus = false;
    this.referenceNamespace = false;

    this.users = this.options.users || {
        "testuser": {
            password: "testpass",
            xoauth2: {
                accessToken: "testtoken",
                sessionTimeout: 3600 * 1000
            }
        }
    };

    [].concat(this.options.plugins || []).forEach((function(plugin) {
        switch (typeof plugin) {
            case "string":
                require("./plugins/" + plugin.toLowerCase())(this);
                break;
            case "function":
                plugin(this);
                break;
        }
    }).bind(this));

    this.systemFlags = [].concat(this.options.systemFlags || ["\\Answered", "\\Flagged", "\\Draft", "\\Deleted", "\\Seen"]);
    this.storage = this.options.storage || {
        "INBOX": {},
        "": {}
    };
    this.uidnextCache = {}; // keep nextuid values if mailbox gets deleted
    this.folderCache = {};
    this.indexFolders();
}
util.inherits(IMAPServer, Stream);

IMAPServer.prototype.listen = function() {
    var args = Array.prototype.slice.call(arguments);
    this.server.listen.apply(this.server, args);
};

IMAPServer.prototype.close = function(callback) {
    this.server.close(callback);
};

IMAPServer.prototype.createClient = function(socket) {
    var connection = new IMAPConnection(this, socket);
    this.connectionHandlers.forEach((function(handler) {
        handler(connection);
    }).bind(this));
};

IMAPServer.prototype.registerCapability = function(keyword, handler) {
    this.capabilities[keyword] = handler || function() {
        return true;
    };
};

IMAPServer.prototype.setCommandHandler = function(command, handler) {
    command = (command || "").toString().toUpperCase();
    this.commandHandlers[command] = handler;
};

/**
 * Returns a mailbox object from folderCache
 *
 * @param {String} path Pathname for the mailbox
 * @return {Object} mailbox object or undefined
 */
IMAPServer.prototype.getMailbox = function(path) {
    if (path.toUpperCase() === "INBOX") {
        return this.folderCache.INBOX;
    }
    return this.folderCache[path];
};

/**
 * Schedules a notifying message
 *
 * @param {Object} command An object of untagged response message
 * @param {Object|String} mailbox Mailbox the message is related to
 * @param {Object} ignoreConnection if set the selected connection ignores this notification
 */
IMAPServer.prototype.notify = function(command, mailbox, ignoreConnection) {
    command.notification = true;
    this.emit("notify", {
        command: command,
        mailbox: mailbox,
        ignoreConnection: ignoreConnection
    });
};

/**
 * Retrieves a function for an IMAP command. If the command is not cached
 * tries to load it from a file in the commands directory
 *
 * @param {String} command Command name
 * @return {Function} handler for the specified command
 */
IMAPServer.prototype.getCommandHandler = function(command) {
    command = (command || "").toString().toUpperCase();

    var handler;

    // try to autoload if not supported
    if (!this.commandHandlers[command]) {
        try {
            handler = require("./commands/" + command.toLowerCase());
            this.setCommandHandler(command, handler);
        } catch (E) {
            //console.log(E);
        }
    }

    return this.commandHandlers[command] || false;
};

/**
 * Returns some useful information about a mailbox that can be used with STATUS, SELECT and EXAMINE
 *
 * @param {Object|String} mailbox Mailbox object or path
 */
IMAPServer.prototype.getStatus = function(mailbox) {
    if (typeof mailbox === "string") {
        mailbox = this.getMailbox(mailbox);
    }
    if (!mailbox) {
        return false;
    }

    var flags = {},
        seen = 0,
        unseen = 0,
        permanentFlags = [].concat(mailbox.permanentFlags || []);

    mailbox.messages.forEach((function(message) {

        if (message.flags.indexOf("\\Seen") < 0) {
            unseen++;
        } else {
            seen++;
        }

        message.flags.forEach((function(flag) {
            if (!flags[flag]) {
                flags[flag] = 1;
            } else {
                flags[flag] ++;
            }

            if (permanentFlags.indexOf(flag) < 0) {
                permanentFlags.push(flag);
            }
        }).bind(this));

    }).bind(this));

    return {
        flags: flags,
        seen: seen,
        unseen: unseen,
        permanentFlags: permanentFlags
    };
};

/**
 * Validates a date value. Useful for validating APPEND dates
 *
 * @param {String} date Date value to be validated
 * @return {Boolean} Returns true if the date string is in IMAP date-time format
 */
IMAPServer.prototype.validateInternalDate = function(date) {
    if (!date || typeof date !== "string") {
        return false;
    }
    return !!date.match(/^([ \d]\d)\-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([\-+])(\d{2})(\d{2})$/);
};

/**
 * Converts a date object to a valid date-time string format
 *
 * @param {Object} date Date object to be converted
 * @return {String} Returns a valid date-time formatted string
 */
IMAPServer.prototype.formatInternalDate = function(date) {
    var day = date.getDate(),
        month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        ][date.getMonth()],
        year = date.getFullYear(),
        hour = date.getHours(),
        minute = date.getMinutes(),
        second = date.getSeconds(),
        tz = date.getTimezoneOffset(),
        tzHours = Math.abs(Math.floor(tz / 60)),
        tzMins = Math.abs(tz) - tzHours * 60;

    return (day < 10 ? "0" : "") + day + "-" + month + "-" + year + " " +
        (hour < 10 ? "0" : "") + hour + ":" + (minute < 10 ? "0" : "") +
        minute + ":" + (second < 10 ? "0" : "") + second + " " +
        (tz > 0 ? "-" : "+") + (tzHours < 10 ? "0" : "") + tzHours +
        (tzMins < 10 ? "0" : "") + tzMins;
};

/**
 * Creates a mailbox with specified path
 *
 * @param {String} path Pathname for the mailbox
 * @param {Object} [defaultMailbox] use this object as the mailbox to add instead of empty'
 */
IMAPServer.prototype.createMailbox = function(path, defaultMailbox) {
    // Ensure case insensitive INBOX
    if (path.toUpperCase() === "INBOX") {
        throw new Error("INBOX can not be modified");
    }

    // detect namespace for the path
    var namespace = "",
        storage,
        folderPath;

    Object.keys(this.storage).forEach((function(key) {
        if (key === "INBOX") {
            // Ignore INBOX
            return;
        }
        var ns = key.length ? key.substr(0, key.length - this.storage[key].separator.length) : key;
        if (key.length && (path === ns || path.substr(0, key.length) === key)) {
            if (path === ns) {
                throw new Error("Used mailbox name is a namespace value");
            }
            namespace = key;
        } else if (!namespace && !key && this.storage[key].type === "personal") {
            namespace = key;
        }
    }).bind(this));

    if (!this.storage[namespace]) {
        throw new Error("Unknown namespace");
    } else {
        folderPath = path;
        storage = this.storage[namespace];

        if (storage.type !== "personal") {
            throw new Error("Permission denied");
        }

        if (folderPath.substr(-storage.separator.length) === storage.separator) {
            folderPath = folderPath.substr(0, folderPath.length - storage.separator.length);
        }

        if (this.folderCache[folderPath] && this.folderCache[folderPath].flags.indexOf("\\Noselect") < 0) {
            throw new Error("Mailbox already exists");
        }

        path = folderPath;
        folderPath = folderPath.substr(namespace.length).split(storage.separator);
    }

    var parent = storage,
        curPath = namespace;

    if (curPath) {
        curPath = curPath.substr(0, curPath.length - storage.separator.length);
    }

    folderPath.forEach((function(folderName) {
        curPath += (curPath.length ? storage.separator : "") + folderName;

        var folder = this.getMailbox(curPath) || false;

        if (folder && folder.flags && folder.flags.indexOf("\\NoInferiors") >= 0) {
            throw new Error("Can not create subfolders for " + folder.path);
        }

        if (curPath === path && defaultMailbox) {
            folder = defaultMailbox;
            this.processMailbox(curPath, folder, namespace);
            parent.folders = parent.folders || {};
            parent.folders[folderName] = folder;

            folder.uidnext = Math.max(folder.uidnext, this.uidnextCache[curPath] || 1);
            delete this.uidnextCache[curPath];
            this.folderCache[curPath] = folder;
        } else if (!folder) {
            folder = {
                subscribed: false
            };
            this.processMailbox(curPath, folder, namespace);
            parent.folders = parent.folders || {};
            parent.folders[folderName] = folder;

            delete this.uidnextCache[curPath];
            this.folderCache[curPath] = folder;
        }

        if (parent !== storage) {
            // Remove NoSelect if needed
            this.removeFlag(parent.flags, "\\Noselect");

            // Remove \HasNoChildren and add \\HasChildren from parent
            this.toggleFlags(parent.flags, ["\\HasNoChildren", "\\HasChildren"], 1);
        } else if (folder.namespace === this.referenceNamespace) {
            if (this.referenceNamespace.substr(0, this.referenceNamespace.length - this.storage[this.referenceNamespace].separator.length).toUpperCase === "INBOX") {
                this.toggleFlags(this.storage.INBOX.flags, ["\\HasNoChildren", "\\HasChildren"], 1);
            }
        }

        parent = folder;
    }).bind(this));
};

/**
 * Deletes a mailbox with specified path
 *
 * @param {String} path Pathname for the mailbox
 * @param {boolean} keepContents If true do not delete messages
 */
IMAPServer.prototype.deleteMailbox = function(path, keepContents) {
    // Ensure case insensitive INBOX
    if (path.toUpperCase() === "INBOX") {
        throw new Error("INBOX can not be modified");
    }

    // detect namespace for the path
    var mailbox,
        storage,
        namespace = "",
        folderPath = path,
        folderName,
        parent,
        parentKey;

    Object.keys(this.storage).forEach((function(key) {
        if (key === "INBOX") {
            // Ignore INBOX
            return;
        }
        var ns = key.length ? key.substr(0, key.length - this.storage[key].separator.length) : key;
        if (key.length && (path === ns || path.substr(0, key.length) === key)) {
            if (path === ns) {
                throw new Error("Used mailbox name is a namespace value");
            }
            namespace = key;
        } else if (!namespace && !key && this.storage[key].type === "personal") {
            namespace = key;
        }
    }).bind(this));

    if (!this.storage[namespace]) {
        throw new Error("Unknown namespace");
    } else {
        parent = storage = this.storage[namespace];

        if (storage.type !== "personal") {
            throw new Error("Permission denied");
        }

        if (folderPath.substr(-storage.separator.length) === storage.separator) {
            folderPath = folderPath.substr(0, folderPath.length - storage.separator.length);
        }

        mailbox = this.folderCache[folderPath];

        if (!mailbox || (
                mailbox.flags.indexOf("\\Noselect") >= 0 &&
                Object.keys(mailbox.folders || {}).length)) {
            throw new Error("Mailbox does not exist");
        }

        folderPath = folderPath.split(storage.separator);
        folderName = folderPath.pop();

        parentKey = folderPath.join(storage.separator);
        if (parentKey !== "INBOX") {
            parent = this.folderCache[folderPath.join(storage.separator)] || parent;
        }

        if (mailbox.folders && Object.keys(mailbox.folders).length && !keepContents) {
            // anyone who has this mailbox selected is going to stay with
            // `reference` object. any new select is going to go to `folder`
            var reference = mailbox,
                folder = {};

            Object.keys(reference).forEach(function(key) {
                if (key !== "messages") {
                    folder[key] = reference[key];
                } else {
                    folder[key] = [];
                }
            });

            this.ensureFlag(folder.flags, "\\Noselect");
            parent.folders[folderName] = folder;
        } else {
            delete this.folderCache[mailbox.path];
            this.uidnextCache[mailbox.path] = mailbox.uidnext;
            delete parent.folders[folderName];

            if (parent !== storage) {
                if (parent.flags.indexOf("\\Noselect") >= 0 &&
                    !Object.keys(parent.folders || {}).length
                ) {
                    this.deleteMailbox(parent.path);
                } else {
                    this.toggleFlags(parent.flags, ["\\HasNoChildren", "\\HasChildren"], Object.keys(parent.folders || {}).length ? 1 : 0);
                }
            } else if (namespace === this.referenceNamespace) {
                if (this.referenceNamespace.substr(0, this.referenceNamespace.length - this.storage[this.referenceNamespace].separator.length).toUpperCase === "INBOX") {
                    this.toggleFlags(this.storage.INBOX.flags, ["\\HasNoChildren", "\\HasChildren"], Object.keys(storage.folders || {}).length ? 1 : 0);
                }
            }
        }
    }
};

/**
 * INBOX has its own namespace
 */
IMAPServer.prototype.indexFolders = function() {
    var folders = {};

    var walkTree = (function(path, separator, branch, namespace) {
        var keyObj = namespace === "INBOX" ? {
            INBOX: true
        } : branch;

        Object.keys(keyObj).forEach((function(key) {

            var curBranch = branch[key],
                curPath = (path ? path + (path.substr(-1) !== separator ? separator : "") : "") + key;

            folders[curPath] = curBranch;
            this.processMailbox(curPath, curBranch, namespace);

            // ensure uid, flags and internaldate for every message
            curBranch.messages.forEach((function(message, i) {

                // If the input was a raw message, convert it to an object
                if (typeof message === "string") {
                    curBranch.messages[i] = message = {
                        raw: message
                    };
                }

                this.processMessage(message, curBranch);
            }).bind(this));

            if (namespace !== "INBOX" && curBranch.folders && Object.keys(curBranch.folders).length) {
                walkTree(curPath, separator, curBranch.folders, namespace);
            }

        }).bind(this));
    }).bind(this);

    // Ensure INBOX namespace always exists
    if (!this.storage.INBOX) {
        this.storage.INBOX = {};
    }

    Object.keys(this.storage).forEach((function(key) {
        if (key === "INBOX") {
            walkTree("", "/", this.storage, "INBOX");
        } else {
            this.storage[key].folders = this.storage[key].folders || {};
            this.storage[key].separator = this.storage[key].separator || key.substr(-1) || "/";
            this.storage[key].type = this.storage[key].type || "personal";

            if (this.storage[key].type === "personal" && this.referenceNamespace === false) {
                this.referenceNamespace = key;
            }

            walkTree(key, this.storage[key].separator, this.storage[key].folders, key);
        }
    }).bind(this));

    if (!this.referenceNamespace) {
        this.storage[""] = this.storage[""] || {};
        this.storage[""].folders = this.storage[""].folders || {};
        this.storage[""].separator = this.storage[""].separator || "/";
        this.storage[""].type = "personal";
        this.referenceNamespace = "";
    }

    if (!this.storage.INBOX.separator && this.referenceNamespace !== false) {
        this.storage.INBOX.separator = this.storage[this.referenceNamespace].separator;
    }

    if (this.referenceNamespace.substr(0, this.referenceNamespace.length - this.storage[this.referenceNamespace].separator.length).toUpperCase === "INBOX") {
        this.toggleFlags(this.storage.INBOX.flags, ["\\HasChildren", "\\HasNoChildren"],
            this.storage[this.referenceNamespace].folders && Object.keys(this.storage[this.referenceNamespace].folders).length ? 0 : 1);
    }

    this.folderCache = folders;
};

IMAPServer.prototype.processMailbox = function(path, mailbox, namespace) {
    mailbox.path = path;

    mailbox.namespace = namespace;
    mailbox.uid = mailbox.uid || 1;
    mailbox.uidvalidity = mailbox.uidvalidity || this.uidnextCache[path] || 1;
    mailbox.flags = [].concat(mailbox.flags || []);
    mailbox.allowPermanentFlags = "allowPermanentFlags" in mailbox ? mailbox.allowPermanentFlags : true;
    mailbox.permanentFlags = [].concat(mailbox.permanentFlags || this.systemFlags);

    mailbox.subscribed = "subscribed" in mailbox ? !!mailbox.subscribed : true;

    // ensure message array
    mailbox.messages = [].concat(mailbox.messages || []);

    // ensure highest uidnext
    mailbox.uidnext = Math.max.apply(Math, [mailbox.uidnext || 1].concat(mailbox.messages.map(function(message) {
        return (message.uid || 0) + 1;
    })));

    this.toggleFlags(mailbox.flags, ["\\HasChildren", "\\HasNoChildren"],
        mailbox.folders && Object.keys(mailbox.folders).length ? 0 : 1);
};

/**
 * Toggles listed flags. Vlags with `value` index will be turned on,
 * other listed fields are removed from the array
 *
 * @param {Array} flags List of flags
 * @param {Array} checkFlags Flags to toggle
 * @param {Number} value Flag from checkFlags array with value index is toggled
 */
IMAPServer.prototype.toggleFlags = function(flags, checkFlags, value) {
    [].concat(checkFlags || []).forEach((function(flag, i) {
        if (i === value) {
            this.ensureFlag(flags, flag);
        } else {
            this.removeFlag(flags, flag);
        }
    }).bind(this));
};

/**
 * Ensures that a list of flags includes selected flag
 *
 * @param {Array} flags An array of flags to check
 * @param {String} flag If the flag is missing, add it
 */
IMAPServer.prototype.ensureFlag = function(flags, flag) {
    if (flags.indexOf(flag) < 0) {
        flags.push(flag);
    }
};

/**
 * Removes a flag from a list of flags
 *
 * @param {Array} flags An array of flags to check
 * @param {String} flag If the flag is in the list, remove it
 */
IMAPServer.prototype.removeFlag = function(flags, flag) {
    var i;
    if (flags.indexOf(flag) >= 0) {
        for (i = flags.length - 1; i >= 0; i--) {
            if (flags[i] === flag) {
                flags.splice(i, 1);
            }
        }
    }
};

IMAPServer.prototype.processMessage = function(message, mailbox) {
    // internaldate should always be a Date object
    message.internaldate = message.internaldate || new Date();
    if (Object.prototype.toString.call(message.internaldate) === "[object Date]") {
        message.internaldate = this.formatInternalDate(message.internaldate);
    }
    message.flags = [].concat(message.flags || []);
    message.uid = message.uid || mailbox.uidnext++;

    // Allow plugins to process messages
    this.messageHandlers.forEach((function(handler) {
        handler(this, message, mailbox);
    }).bind(this));
};

/**
 * Appends a message to a mailbox
 *
 * @param {Object|String} mailbox Mailbox to append to
 * @param {Array} flags Flags for the message
 * @param {String|Date} internaldate Receive date-time for the message
 * @param {String} raw Message source
 * @param {Object} [ignoreConnection] To not advertise new message to selected connection
 * @return An object of the form { mailbox, message }
 */
IMAPServer.prototype.appendMessage = function(mailbox, flags, internaldate, raw, ignoreConnection) {
    if (typeof mailbox === "string") {
        mailbox = this.getMailbox(mailbox);
    }

    var message = {
        flags: flags,
        internaldate: internaldate,
        raw: raw
    };

    mailbox.messages.push(message);
    this.processMessage(message, mailbox);

    this.notify({
        tag: "*",
        attributes: [
            mailbox.messages.length, {
                type: "ATOM",
                value: "EXISTS"
            }
        ]
    }, mailbox, ignoreConnection);

    return { mailbox: mailbox, message: message };
};

IMAPServer.prototype.matchFolders = function(reference, match) {
    var includeINBOX = false;

    if (reference === "" && this.referenceNamespace !== false) {
        reference = this.referenceNamespace;
        includeINBOX = true;
    }

    if (!this.storage[reference]) {
        return [];
    }

    var namespace = this.storage[reference],
        lookup = (reference || "") + match,
        result = [];

    var query = new RegExp("^" + lookup.
        // escape regex symbols
        replace(/([\\^$+?!.():=\[\]|,\-])/g, "\\$1").replace(/[*]/g, ".*").replace(/[%]/g, "[^" + (namespace.separator.replace(/([\\^$+*?!.():=\[\]|,\-])/g, "\\$1")) + "]*") +
        "$",
        "");

    if (includeINBOX && ((reference ? reference + namespace.separator : "") + "INBOX").match(query)) {
        result.push(this.folderCache.INBOX);
    }

    if (reference === "" && this.referenceNamespace !== false) {
        reference = this.referenceNamespace;
    }

    Object.keys(this.folderCache).forEach((function(path) {
        if (path.match(query) &&
            (this.folderCache[path].flags.indexOf("\\NonExistent") < 0 || this.folderCache[path].path === match) &&
            this.folderCache[path].namespace === reference) {
            result.push(this.folderCache[path]);
        }
    }).bind(this));

    return result;
};

/**
 * Retrieves an array of messages that fit in the specified range criteria
 *
 * @param {Object|String} mailbox Mailbox to look for the messages
 * @param {String} range Message range (eg. "*:4,5,7:9")
 * @param {Boolean} isUid If true, use UID values, not sequence indexes for comparison
 * @return {Array} An array of messages in the form of [[seqIndex, message]]
 */
IMAPServer.prototype.getMessageRange = function(mailbox, range, isUid) {
    range = (range || "").toString();
    if (typeof mailbox === "string") {
        mailbox = this.getMailbox(mailbox);
    }

    var result = [],
        rangeParts = range.split(","),
        messages = Array.isArray(mailbox) ? mailbox : mailbox.messages,
        uid,
        totalMessages = messages.length,
        maxUid = 0,

        inRange = function(nr, ranges, total) {
            var range, from, to;
            for (var i = 0, len = ranges.length; i < len; i++) {
                range = ranges[i];
                to = range.split(":");
                from = to.shift();
                if (from === "*") {
                    from = total;
                }
                from = Number(from) || 1;
                to = to.pop() || from;
                to = Number(to === "*" && total || to) || from;

                if (nr >= Math.min(from, to) && nr <= Math.max(from, to)) {
                    return true;
                }
            }
            return false;
        };

    messages.forEach(function(message) {
        if (message.uid > maxUid) {
            maxUid = message.uid;
        }
    });

    for (var i = 0, len = messages.length; i < len; i++) {
        uid = messages[i].uid || 1;
        if (inRange(isUid ? uid : i + 1, rangeParts, isUid ? maxUid : totalMessages)) {
            result.push([i + 1, messages[i]]);
        }
    }

    return result;
};

function IMAPConnection(server, socket) {
    this.server = server;
    this.socket = socket;
    this.options = this.server.options;

    this.state = "Not Authenticated";

    this.secureConnection = !!this.options.secureConnection;

    this._remainder = "";
    this._command = "";
    this._literalRemaining = 0;

    this.inputHandler = false;

    this._commandQueue = [];
    this._processing = false;

    if (this.options.debug) {
        this.socket.pipe(process.stdout);
    }

    this.socket.on("data", this.onData.bind(this));
    this.socket.on("close", this.onClose.bind(this));
    this.socket.on("error", this.onError.bind(this));

    this.directNotifications = false;
    this._notificationCallback = this.onNotify.bind(this);
    this.notificationQueue = [];
    this.server.on("notify", this._notificationCallback);

    this.socket.write("* OK Hoodiecrow ready for rumble\r\n");
}

IMAPConnection.prototype.onClose = function() {
    this.socket.removeAllListeners();
    this.socket = null;
    try {
        this.socket.end();
    } catch (E) {}
    this.server.removeListener("notify", this._notificationCallback);
};

IMAPConnection.prototype.onError = function(err) {
    if (this.options.debug) {
        console.log("Socket error event emitted, %s", Date());
        console.log(err.stack);
    }
    try {
        this.socket.end();
    } catch (E) {}
};

IMAPConnection.prototype.onData = function(chunk) {
    var match, str;

    str = (chunk || "").toString("binary");

    if (this._literalRemaining) {
        if (this._literalRemaining > str.length) {
            this._literalRemaining -= str.length;
            this._command += str;
            return;
        }
        this._command += str.substr(0, this._literalRemaining);
        str = str.substr(this._literalRemaining);
        this._literalRemaining = 0;
    }

    this._remainder = str = this._remainder + str;
    while ((match = str.match(/(\{(\d+)(\+)?\})?\r?\n/))) {
        if (!match[2]) {

            if (this.inputHandler) {
                this.inputHandler(this._command + str.substr(0, match.index));
            } else {
                this.scheduleCommand(this._command + str.substr(0, match.index));
            }

            this._remainder = str = str.substr(match.index + match[0].length);
            this._command = "";
            continue;
        }

        if (match[3] !== "+") {
            if (this.socket && !this.socket.destroyed) {
                this.socket.write("+ Go ahead\r\n");
            }
        }

        this._remainder = "";
        this._command += str.substr(0, match.index + match[0].length);
        this._literalRemaining = Number(match[2]);

        str = str.substr(match.index + match[0].length);

        if (this._literalRemaining > str.length) {
            this._command += str;
            this._literalRemaining -= str.length;
            return;
        } else {
            this._command += str.substr(0, this._literalRemaining);
            this._remainder = str = str.substr(this._literalRemaining);
            this._literalRemaining = 0;
        }
    }
};

IMAPConnection.prototype.onNotify = function(notification) {
    if (notification.ignoreConnection === this) {
        return;
    }
    if (!notification.mailbox ||
        (this.selectedMailbox &&
            this.selectedMailbox === (
                typeof notification.mailbox === "string" &&
                this.getMailbox(notification.mailbox) || notification.mailbox))) {
        this.notificationQueue.push(notification.command);
        if (this.directNotifications) {
            this.processNotifications();
        }
    }
};

IMAPConnection.prototype.upgradeConnection = function(callback) {
    this.upgrading = true;

    this.options.credentials.ciphers = this.options.credentials.ciphers || "ECDH+AESGCM:DH+AESGCM:ECDH+AES256:DH+AES256:ECDH+AES128:DH+AES:ECDH+3DES:DH+3DES:RSA+AESGCM:RSA+AES:RSA+3DES:!aNULL:!MD5:!DSS";
    if (!("honorCipherOrder" in this.options.credentials)) {
        this.options.credentials.honorCipherOrder = true;
    }

    var secureContext = tls.createSecureContext(this.options.credentials);
    var socketOptions = {
        secureContext: secureContext,
        isServer: true,
        server: this.server.server,

        // throws if SNICallback is missing, so we set a default callback
        SNICallback: function(servername, cb) {
            cb(null, secureContext);
        }
    };

    // remove all listeners from the original socket besides the error handler
    this.socket.removeAllListeners();
    this.socket.on("error", this.onError.bind(this));

    // upgrade connection
    var secureSocket = new tls.TLSSocket(this.socket, socketOptions);

    secureSocket.on("close", this.onClose.bind(this));
    secureSocket.on("error", this.onError.bind(this));
    secureSocket.on("clientError", this.onError.bind(this));

    secureSocket.on("secure", function() {
        this.secureConnection = true;
        this.socket = secureSocket;
        this.upgrading = false;
        this.socket.on("data", this.onData.bind(this));
        callback();
    }.bind(this));
};

IMAPConnection.prototype.processNotifications = function(data) {
    var notification;
    for (var i = 0; i < this.notificationQueue.length; i++) {
        notification = this.notificationQueue[i];

        if (data && ["FETCH", "STORE", "SEARCH"].indexOf((data.command || "").toUpperCase()) >= 0) {
            continue;
        }

        this.send(notification);
        this.notificationQueue.splice(i, 1);
        i--;
        continue;
    }
};

/**
 * Compile a command object to a response string and write it to socket.
 * If the command object has a skipResponse property, the command is
 * ignored
 *
 * @param {Object} response Response IMAP command object to be compiled.
 * @param {String} description
 *   An upper-case string uniquely identifying the response for the benefit of
 *   output handlers that wish to augment/replace the given response.
 * @param {Object} parsed
 *   Original parsed IMAP command that this is in response to.
 * @param {String} data
 *   Original raw IMAP command as a binary string.
 * @param {Object} extra
 *   Response-specific payload, usually the subject of the response.  For
 *   example, the STORE command will pass the impacted message for each updated
 *   FETCH result.  (This may have other names when used, like "affected".)
 */
IMAPConnection.prototype.send = function(response, description, parsed) {
    if (!this.socket || this.socket.destroyed) {
        return;
    }

    if (!response.notification && response.tag !== "*") {
        // arguments[2] should be the original command
        this.processNotifications(parsed);
    } else {
        // override values etc.
    }

    var args = Array.prototype.slice.call(arguments);
    this.server.outputHandlers.forEach((function(handler) {
        handler.apply(null, [this].concat(args));
    }).bind(this));

    // No need to display this response to user
    if (response.skipResponse) {
        return;
    }

    var compiled = imapHandler.compiler(response);

    if (this.options.debug) {
        console.log("SEND: %s", compiled);
    }

    if (this.socket && !this.socket.destroyed) {
        this.socket.write(new Buffer(compiled + "\r\n", "binary"));
    }
};

IMAPConnection.prototype.scheduleCommand = function(data) {
    var parsed,
        tag = (data.match(/\s*([^\s]+)/) || [])[1] || "*";

    try {
        parsed = imapHandler.parser(data, {
            literalPlus: this.server.literalPlus
        });
    } catch (E) {
        this.send({
            tag: "*",
            command: "BAD",
            attributes: [{
                type: "SECTION",
                section: [{
                    type: "ATOM",
                    value: "SYNTAX"
                }]
            }, {
                type: "TEXT",
                value: E.message
            }]
        }, "ERROR MESSAGE", null, data, E);

        this.send({
            tag: tag,
            command: "BAD",
            attributes: [{
                type: "TEXT",
                value: "Error parsing command"
            }]
        }, "ERROR RESPONSE", null, data, E);

        return;
    }

    if (this.server.getCommandHandler(parsed.command)) {
        this._commandQueue.push({
            parsed: parsed,
            data: data
        });
        this.processQueue();
    } else {
        this.send({
            tag: parsed.tag,
            command: "BAD",
            attributes: [{
                type: "TEXT",
                value: "Invalid command " + parsed.command + ""
            }]
        }, "UNKNOWN COMMAND", parsed, data);
    }
};

IMAPConnection.prototype.processQueue = function(force) {
    var element;

    if (!force && this._processing) {
        return;
    }

    if (!this._commandQueue.length) {
        this._processing = false;
        return;
    }

    this._processing = true;

    element = this._commandQueue.shift();
    try {
        this.server.getCommandHandler(element.parsed.command)(this, element.parsed, element.data, (function() {
            if (!this._commandQueue.length) {
                this._processing = false;
            } else {
                this.processQueue(true);
            }
        }).bind(this));
    } catch (ex) {
      console.error("Error processing command:", ex, "\n", ex.stack);
      this.send({
          tag: element.parsed.tag,
          command: "NO",
          attributes: [{
              type: "TEXT",
              value: "Server error: " + ex + ""
          }]
      }, "SERVER ERROR", element.parsed, element.data);
    }
};

/**
 * Removes messages with \Deleted flag
 *
 * @param {Object} mailbox Mailbox to check for
 * @param {Boolean} [ignoreSelf] If set to true, does not send any notices to itself
 * @param {Boolean} [ignoreSelf] If set to true, does not send EXISTS notice to itself
 */
IMAPConnection.prototype.expungeDeleted = function(mailbox, ignoreSelf, ignoreExists) {
  this.expungeSpecificMessages(
      mailbox,
      function (message) {
        return message.flags.indexOf("\\Deleted") >= 0;
      },
      ignoreSelf,
      ignoreExists);
};

/**
 * Given a set of messages in a mailbox (possibly via getMessageRange), remove
 * them from the mailbox and generate EXPUNGE notifications.
 *
 * @param {Object} mailbox Mailbox to check for
 * @param {Function|Array} messagesOrFilterFunc An Array of messages in the
 *     folder that should be removed or a filtering function that indicates
 *     messages to be removed by returning true.
 * @param {Boolean} [ignoreSelf] If set to true, does not send any notices to itself
 * @param {Boolean} [ignoreSelf] If set to true, does not send EXISTS notice to itself
 */
IMAPConnection.prototype.expungeSpecificMessages = function(mailbox, messagesOrFilterFunc, ignoreSelf, ignoreExists) {
    var deleted = 0,
        // old copy is required for those sessions that run FETCH before
        // displaying the EXPUNGE notice
        mailboxCopy = [].concat(mailbox.messages);

    var filterFunc;
    if (Array.isArray(messagesOrFilterFunc)) {
      var messages = messagesOrFilterFunc;
      filterFunc = function(message) {
        return messages.indexOf(message) >= 0;
      };
    } else {
      filterFunc = messagesOrFilterFunc;
    }

    for (var i = 0; i < mailbox.messages.length; i++) {
      var message = mailbox.messages[i];
        if (filterFunc(message)) {
            deleted++;
            mailbox.messages[i].ghost = true;
            mailbox.messages.splice(i, 1);
            this.server.notify({
                tag: "*",
                attributes: [
                    i + 1, {
                        type: "ATOM",
                        value: "EXPUNGE"
                    }
                ]
            }, mailbox, ignoreSelf ? this : false);
            i--;
        }
    }

    if (deleted) {
        this.server.notify({
            tag: "*",
            attributes: [
                mailbox.messages.length, {
                    type: "ATOM",
                    value: "EXISTS"
                }
            ],
            // distribute the old mailbox data with the notification
            mailboxCopy: mailboxCopy,
        }, mailbox, ignoreSelf || ignoreExists ? this : false);
    }
};
