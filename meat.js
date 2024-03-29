var settingsSantize = {
    allowedTags: [ 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol',
    'nl', 'li', 'b', 'i', 'strong', 'em', 'strike', 'code', 'hr', 'br', 'div',
    'table', 'thead', 'caption', 'tbody', 'tr', 'th', 'td', 'pre', 'iframe','marquee','button','input'
    ,'details','summary','progress','meter','font','h1','h2','span','select','option','abbr',
    'acronym','adress','article','aside','bdi','bdo','big','center','site',
    'data','datalist','dl','del','dfn','dialog','dir','dl','dt','fieldset',
    'figure','figcaption','header','ins','kbd','legend','mark','nav',
    'optgroup','form','q','rp','rt','ruby','s','sample','section','small',
    'sub','sup','template','textarea','tt','u'],
  allowedAttributes: {
    a: [ 'href', 'name', 'target' ],
    p:['align'],
    table:['align','border','bgcolor','cellpadding','cellspadding','frame','rules','width'],
    tbody:['align','valign'],
    tfoot:['align','valign'],
    td:['align','colspan','headers','nowrap'],
    th:['align','colspan','headers','nowrap'],
    textarea:['cols','dirname','disabled','placeholder','maxlength','readonly','required','rows','wrap'],
    pre:['width'],
    ol:['compact','reversed','start','type'],
    option:['disabled'],
    optgroup:['disabled','label','selected'],
    legend: ['align'],
    li:['type','value'],
    hr:['align','noshade','size','width'],
    fieldset:['disabled'],
    dialog:['open'],
    dir:['compact'],
    bdo:['dir'],
    div:['class'],
    marquee:['behavior','bgcolor','direction','width','height','loop'],
    button: ['disabled'],
    input:['value','type','disabled','maxlength','max','min','placeholder','readonly','required'],
    details:['open'],
    div:['align'],
    progress:['value','max'],
    meter:['value','max','min','optimum','low','high'],
    font:['size','family','color'],
    select:['disabled','multiple','require'],
    ul:['type','compact'],  
    "*":['hidden','spellcheck','title','contenteditable','data-style']
  },
  selfClosing: [ 'img', 'br', 'hr', 'area', 'base', 'basefont', 'input', 'link', 'meta' , 'wbr'],
  allowedSchemes: [ 'http', 'https', 'ftp', 'mailto', 'data' ],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: [ 'href', 'src', 'cite' ],
  allowProtocolRelative: true
} 

const log = require("./log.js").log;
const Ban = require("./ban.js");
const Utils = require("./utils.js");
const io = require('./index.js').io;
const settings = require("./settings.json");
const sanitize = require('sanitize-html');

let roomsPublic = [];
let rooms = {};
let usersAll = [];
var userips = {}; //It's just for the alt limit
var guidcounter = 0;

exports.beat = function() {
    io.on('connection', function(socket) {
        new User(socket);
    });
};

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); // The maximum is exclusive and the minimum is inclusive
}

function checkRoomEmpty(room) {
    if (room.users.length != 0) return;

    log.info.log('debug', 'removeRoom', {
        room: room
    });

    let publicIndex = roomsPublic.indexOf(room.rid);
    if (publicIndex != -1)
        roomsPublic.splice(publicIndex, 1);
    
    room.deconstruct();
    delete rooms[room.rid];
    delete room;
}

class Room {
    constructor(rid, prefs) {
        this.rid = rid;
        this.prefs = prefs;
        this.users = [];
    }

    deconstruct() {
        try {
            this.users.forEach((user) => {
                user.disconnect();
            });
        } catch (e) {
            log.info.log('warn', 'roomDeconstruct', {
                e: e,
                thisCtx: this
            });
        }
        //delete this.rid;
        //delete this.prefs;
        //delete this.users;
    }

    isFull() {
        return this.users.length >= this.prefs.room_max;
    }

    join(user) {
        user.socket.join(this.rid);
        this.users.push(user);

        this.updateUser(user);
    }

    leave(user) {
        // HACK
        try {
            this.emit('leave', {
                 guid: user.guid
            });
     
            let userIndex = this.users.indexOf(user);
     
            if (userIndex == -1) return;
            this.users.splice(userIndex, 1);
     
            checkRoomEmpty(this);
        } catch(e) {
            log.info.log('warn', 'roomLeave', {
                e: e,
                thisCtx: this
            });
        }
    }

    updateUser(user) {
		this.emit('update', {
			guid: user.guid,
			userPublic: user.public
        });
    }

    getUsersPublic() {
        let usersPublic = {};
        this.users.forEach((user) => {
            usersPublic[user.guid] = user.public;
        });
        return usersPublic;
    }

    emit(cmd, data) {
		io.to(this.rid).emit(cmd, data);
    }
}

function newRoom(rid, prefs) {
    rooms[rid] = new Room(rid, prefs);
    log.info.log('debug', 'newRoom', {
        rid: rid
    });
}

let userCommands = {
    "godmode": function(word) {
        let success = word == this.room.prefs.godword;
        if (success){
            this.private.runlevel = 3;
            this.socket.emit('admin')
        }else{
            this.socket.emit('alert',`Wrong password. Did you try "Password"? Or you've got blocked by an admin, or you typed an invalid godword.`)
        }
        log.info.log('debug', 'godmode', {
            guid: this.guid,
            success: success
        });
    },
    "sanitize": function() {
        let sanitizeTerms = ["false", "off", "disable", "disabled", "f", "o", "d", "no", "n"];
        let argsString = Utils.argsString(arguments);
        this.private.sanitize = !sanitizeTerms.includes(argsString.toLowerCase());
    },
    kick:function(data){
        if(this.private.runlevel<3){
            this.socket.emit('alert','This command requires administrative privileges to kick a user.')
            return;
        }
        let pu = this.room.getUsersPublic()[data]
        if(pu&&pu.color){
            let target;
            this.room.users.map(n=>{
                if(n.guid==data){
                    target = n;
                }
            })
                target.socket.emit("kick",{
                    reason:"You got kicked."
                })
                target.disconnect()
        }else{
            this.socket.emit('alert','The user you are trying to kick left. Get dunked on nerd')
        }
    },
    css:function(...txt){
        this.room.emit('css',{
            guid:this.guid,
            css:txt.join(' ')
        })
    },
    ban:function(data){
        if(this.private.runlevel<3){
            this.socket.emit('alert','This command requires administrative privileges to ban a user.')
            return;
        }
        let pu = this.room.getUsersPublic()[data]
        if(pu&&pu.color){
            let target;
            this.room.users.map(n=>{
                if(n.guid==data){
                    target = n;
                }
            })

                target.socket.emit("ban",{
                    reason:"You got banned."
                })
		target.disconnect();
		target.socket.disconnect();
        }else{
            this.socket.emit('alert','The user you are trying to ban left. Get dunked on nerd')
        }
    },
    "unban": function(ip) {
		Ban.removeBan(ip)
    },
    "joke": function() {
        this.room.emit("joke", {
            guid: this.guid,
            rng: Math.random()
        });
    },
    "fact": function() {
        this.room.emit("fact", {
            guid: this.guid,
            rng: Math.random()
        });
    },
    wtf: function (text) {
        var wtf = [
            "i cut a hole in my computer so i can fuck it",
            "i hate minorities",
            "i said /godmode password and it didnt work",
            "i like to imagine i have sex with my little pony characters",
            "ok yall are grounded grounded grounded grounded grounded grounded grounded grounded grounded for 64390863098630985 years go to ur room",
            "i like to eat dog crap off the ground",
            "i can use inspect element to change your name so i can bully you",
            "i can ban you, my dad is seamus",
            "why do woman reject me, i know i masturbate in public and dont shower but still",
            "put your dick in my nose and lets have nasal sex",
            "my cock is 6 ft so ladies please suck it",
            "please make pope free",
            "whats that color",
            "This PC cannot run Windows 11. The processor isn't supported for Windows 11. While this PC doesn't meet the system requirements, you'll keep getting Windows 10 Updates.",
            "100. Continue.",
            "418. I'm a teapot.",
            "I am SonicFan08 and i like Norbika9Entertainment and grounded videos! Wow! I also block people who call me a gotard!",
            "Bonkey sugar. Anything that makes one physically satisfied. By extension, anything good or desirable. The following are examples of things which are most certainly bonkey sugar...",
            "i like to harass bonziworld fans on bonziworld",
            "there is a fucking white bird in my chest please get him out",
            "i am that frog that is speaking chinese",
            "i don't let anyone have any fun like holy shit i hate bonziworld soooooooooo much!",
            "i make gore art out of dream as fucking usual",
            "yummy yummy two letter object in my tummy! yummy in my tummy! i pretend to be david and terrorize the fuck out of my friends!",
            "why the fuck are you hating Twitter?! what did they do to you?!",
            "This is not a test. You have been caught as a 'funny child harassment' moment. you will be banned. You got banned! Why? Being retarded? IDK. You literally harass BonziWORLD Fans. How dare you!",
            "how many fucking times have i told you? GIVE ME THE MARIO 64 BETA ROM NOW NOW NOW NOW NOW NOW NOW NOW NOW NOW NOW NOW NOW NOW NOW NOW NOW!",
            "no comment",
            `Yeah, of course ${this.public.name} wants me to use /wtf. Haha, look at the stupid ${this.public.color} monkey embarassing himself!" Fuck you. It isn't funny.`,
            "I am getting fucking tired of you using this command. Fucking take a break already!",
            "DeviantArt",
            "You're a fucking asshole!",
            "javascript",
            "BonziWORLD.exe has encountered and error and needs to close. Nah, seriously, you caused this error to happen because you used /wtf.",
            "moo!",
            "host bathbomb",
            "Hi.",
            "hiii i'm soundcard from mapper league",
            "I injected some soundcard syringes into your browser. <small>this is obviously fake</small>",
            "i listen to baby from justin bieber",
            "i watch numberblocks",
            "i watch doodland and now people are calling me a doodtard",
            "i watch bfdi and now people are calling me a objecttard",
            "i post klasky csupo effects and now people are calling me a logotard",
            "i inflate people, and body inflation is my fetish.",
            "i installed BonziBUDDY on my pc and now i have a virus",
		"justin wear a dress", //davidserver sucks
            "i deleted system32",
            "i flood servers, and that makes me cool.",
            "I unironically do ERPs that has body inflation fetishism with people. Do you have a problem with that? YES! INFLATION FUCKING SUCKS YOU STUPID PERSON NAMED GERI!",
            "I unironically do ERPs that has body inflation fetishism with people. Do you have a problem with that? YES! INFLATION FUCKING SUCKS YOU STUPID PERSON NAMED BOWGART!",
            "I unironically do ERPs that has body inflation fetishism with people. Do you have a problem with that? YES! INFLATION FUCKING SUCKS YOU STUPID PERSON NAMED POM POM!",
            "I unironically do ERPs that has body inflation fetishism with people. Do you have a problem with that? YES! INFLATION FUCKING SUCKS YOU STUPID PERSON NAMED WHITTY!",
            "Hi. My name is DanielTR52 and i change my fucking mind every 1 picosecond. Also, ICS fucking sucks. Nope, now he doesnt. Now he does. Now he doesnt. Now he does.",
            "i still use the wii u&trade;",
            "i used homebrew on my nintendo switch and i got banned",
            "i bricked my wii",
            "muda muda muda muda!",
            "i am going to post inflation videos because, remember: 'I inflate people and inflation is my fetish.'",
            "i copy other people's usernames",
            "i use microsoft agent scripting helper for fighting videos against innocent people that did nothing wrong by just friendly commenting",
            "i use microsoft agent scripting helper for gotard videos",
            "i use hotswap for my xbox 360",
            "i boycotted left 4 dead 2",
            "CAN U PLZ UNBAN ME PLZ PLZ PLZ PLZ PLZ PLZ PLZ PLZ",
            `Hey, ${this.public.name}! You're a fucking asshole!`,
            `Damn, ${this.public.name} really likes /wtf`,
            "I use an leaked build of Windows 11 on my computer.",
            "Do you know how much /wtf quotes are there?",
            "Fun Fact: You're a fucking asshole",
            "i watch body inflation videos on youtube",
            "i play left 4 dead games 24/7",
            "i am so cool. i shit on people, add reactions  that make fun of users on discord, and abuse my admin powers. i am really so cool.",
            "This product will not operate when connected to a device which makes unauthorized copies. Please refer to your instruction booklet for more information.",
            "hey medic i like doodland",
            "i installed windows xp on my real computer",
            "i am whistler and i like to say no u all the time",
            "HEY EVERYONE LOOK AT ME I USE NO U ALL THE TIME LMAO",
            "i like to give my viewers anxiety",
            "how to make a bonziworld server?",
            "shock, blood loss, infection; [['oU: hoUhoUhoUhoU]]! i love stabbing!",
            "I AM ANGRY BECAUSE I GOT BANNED! I WILL MAKE A MASH VIDEO OUT OF ME GETTING BANNED!",
            "oh you're approaching me!",
            "MUTED! HEY EVERYONE LOOK AT ME I SAY MUTED IN ALL CAPS WHEN I MUTE SOMEONE LMAO",
            "can you boost my server? no? you're mean!>:(",
            "no u",
            "numberblocks is my fetish",
            "#inflation big haram",
            "Sorry, i don't want you anymore.",
            "Twitter Cancel Culture! Twitter Cancel Culture! Twitter Cancel Culture! Twitter Cancel Culture! Twitter Cancel Culture!",
            "cry about it",
            "SyntaxError: Unexpected string",
            "i post random gummibar videos on bonziworld",
            "i support meatballmars",
            "PLEASE GIVE THIS VIDEO LIKES!!!!! I CANNOT TAKE IT ANYMORE!",
            "I WILL MAKE A BAD VIDEO OUT OF YOU! GRRRRRRRRRRRR!",
            "Muted!",
            "i keep watching doodland like forever now",
            "i mined diamonds with a wooden pickaxe",
            "i kept asking for admin and now i got muted",
            "I FAP TO FEMMEPYRO NO JOKE",
            "i like to imagine that i am getting so fat for no reason at all",
            "i am not kid",
            "i want mario beta rom hack now!",
            "i am a gamer girl yes not man no im not man i am gamer girl so give me money and ill giv you my adress ♥♥",
            "i used grounded threats and now i got hate",
            "i post pbs kids and now people are calling me a pbskidstard",
            "Oh my gosh! PBS Kids new logo came on July 19th!",
            "i will flood the server but people still thinked that i will not flood, the flooder hates are psychopaths, a skiddie, psychology and mentallity",
            "i used inspect element and now i got hate",
            "hi i am vacbedlover want to show my sexual fetish. I just kept evading my ban on collabvm to act like a forkie.",
            "i watch the potty song and now people are calling me a pottytard",
	"i watch junytony's potty song and now people are calling me a pottytard",
            "bonziworld reacts to... zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
            "i am danieltr52 the clown and i have inflation fetish",
            "i watch nature on pbs",
            "i post thomas theme song and now people are calling me a thomastard",
            "i pee my pants",
            "i pee my shorts",
            "i pee my jammies",
	"i post baby einstein caterpillar logo and now people are calling me a babyeinsteintard",
            "Wow! TVOKids is awesome- No! Its not awesome, you idiotic TVOKids fan!",
            "i watch grounded videos and now people are calling me a gotard",
            "Hi i am DanielTR52 and i have inflation fetish my friends please hate on seamus from making bad videos out of me",
            "Excuse me, CUT! We made another color blooper! glass breaking sound effect WAAAAAAAAAAAA! inhale WAAAAAAAAAAAA! Well that was uncalled for. It was! Anyways, you guys are in the colors of the AidenTV logo. Looks down BOING! Oh, oops. It's okay, swap the colors back to normal and then we'll do Take 48! Snap",
            "DOGGIS!", //Yes diogo is a doggis lmfao >:D
            "i watch bfb and now people are calling me a objecttard",
            "This is not a test. You have been caught as a 'funny child harassment' moment. you will be banned. You got banned! Why? Being retarded? IDK. You literally harass BonziWORLD Fans. How dare you!",
            "i post pinkfong and now people are calling me a pinkfongtard",
            "i post pinkfong the potty song and now people are calling me a pinkfongtard",
		"i post baby einstein and now people are calling me a babyeinsteintard",
		"i post pbs and now people are calling me a pbstard",
		"i post logo bloopers and now people are calling me a logoblooperstard",
		"i post wordworld and now people are calling me a wordworldtard",
		"i post jakers and now people are calling me a jakerstard",
		"i post pbs kids funding credits and now i got hate",
		"i post friday night funkin' and now people are calling me a fnftard",
		"i post logo bloopers and now i got hate",
            "my favorite flash nickelodeon clickamajig is Dress Up Sunny Funny",
            "i snort dill pickle popcorn seasoning",
            "i post planet custard's the potty song and now people are calling me a pottytard",
		"i post planet custard and now people are calling me a planetcustardtard",
            "I got a question. but it's a serious, yes, serious thing that I have to say! AAAAAAAAAAA! I! am! not! made! by! Pixel works! Pixel works doesn't make microsoft agent videos! Kieran G&A Doesn't exist! Anymore! So, if you guys keep mocking me that i am made by Pixel works (Originally Aqua) or Kieran G&A, then i am gonna commit kill you! huff, puff, that is all.",
            "This PC cannot run Windows 11. The processor isn't supported for Windows 11. While this PC doesn't meet the system requirements, you'll keep getting Windows 10 Updates.",
            "I made Red Brain Productions, and i deny that i am made by Pixelworks",
            "I am SonicFan08 and i like Norbika9Entertainment and grounded videos! Wow! I also block people who call me a gotard!",
            "When BonziWORLD leaks your memory, your system will go AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "i post i got banned on bonziworld and now i got hate",
            "i post babytv and now people are calling me a babytvtard",
            "i post sf08 news and now i got hate",
            "i listen to spongebob theme song and now i got hate",
            "What the fuck did you just fucking say about me, you little bitch? I'll have you know I graduated top of my class in the Navy Seals, and I've been involved in numerous secret raids on Al-Quaeda, and I have over 300 confirmed kills. I am trained in gorilla warfare and I'm the top sniper in the entire US armed forces. You are nothing to me but just another target. I will wipe you the fuck out with precision the likes of which has never been seen before on this Earth, mark my fucking words. You think you can get away with saying that shit to me over the Internet? Think again, fucker. As we speak I am contacting my secret network of spies across the USA and your IP is being traced right now so you better prepare for the storm, maggot. The storm that wipes out the pathetic little thing you call your life. You're fucking dead, kid. I can be anywhere, anytime, and I can kill you in over seven hundred ways, and that's just with my bare hands. Not only am I extensively trained in unarmed combat, but I have access to the entire arsenal of the United States Marine Corps and I will use it to its full extent to wipe your miserable ass off the face of the continent, you little shit. If only you could have known what unholy retribution your little 'clever' comment was about to bring down upon you, maybe you would have held your fucking tongue. But you couldn't, you didn't, and now you're paying the price, you goddamn idiot. I will shit fury all over you and you will drown in it. You're fucking dead, skiddo.",
		"i post princess lili and now i got hate",
		"i post pbs kids logo effects and now people are calling me a logotard",
		"i post blue screen of death videos",
		"Seamus is a pe- NO YOU FUCKING DON'T!",
		"Everyone! WANNA HEAR SOMETHING? Seamus is a nig- NO YOU FUCKING DON'T!",
		"Seamus Cremeens is a cl- NO YOU FUCKING DON'T!", // nobody fucking says seamus's last name at all
		"Fune: BANZI.LEL BEST SERVA!",
		"i support fune",
	    "i support pinkfong",
		"i support hogi",
		"i post hogi and now people are calling me a hogitard",
		"i post vyond videos and now people are calling me a gotard",
		"Pinkfong: HI! I AM PINKFONG! SUBSKRIBE TO MY CHANNEL NOW!",
		"i copy innocent users' names as a bw org supporter and now i got hate",
		"i tried to name myself pinkfong on the logon screen and now i got hate", //do not type the username "PinkFong", or you will be immediately blacklisted. If you're known as the aformentioned name, you will be banned.
          "i support fune",
          "i support pinkfong",
          "i support hogi",
          "i support baby shark brooklyn",
          "bonzi.lol is the best site ever!",
          "Pinkfong is the best channel ever!",
          "Hogi is the best channel ever!",
          "Bebefinn is the best channel ever!",
          "Baby Shark Broolyn is the best channel ever!",
          "seamus is a pe- NO YOU FUCKING DON'T!",
          "seamus is a nig- NO YOU FUCKING DON'T!",
          "bonzipedia is the best wiki ever",
          "baby shark is the best song ever",
          "The Potty Song is the best song ever",
          "Hello my name is fune and i am obsessed with pedos and groomers so much that i accuse random people of being a pedo and a groomer without any proof and also like to make fake screenshots out of them doing disgusting shit.",
          "Hello my name is pinkfong and i am obsessed with baby shark, nursery rhymes and the potty song so much that i accuse random people of being a pinkfong fan and a nursery rhyme supporter and also like to make nursery rhyme song shit.",
          "I LIKE PINKFONG! ALSO HOGI IS A THE BEST!!!! I HATE PINKFONG HATERS!!! PINKFONG IS THE BEST!!!!!",
          "I LIKE FUNE! ALSO NANO IS A THE BEST!!!! I HATE OTHER BONZIWORLD SITES!!! BONZI DOT LOL IS A THE BEST!!!!!",
          "choccy milk is good",
          "My name is goober and i'm totally not a spy!",
          "bonziworld gave me ptsd",
          "you got trolled!",
          "PURGE! PURGE! DESTROY ALL NEW YEARS! I HATE 2021 SO MUCH! PURGE!",
          "I actually believe in fune's false allegations",
          "Lambda Fortress Community Edition is so good that it's better than this shid site",
          "I AM NOT KID",
          "WE'RE GONNA BEAT YA TO DEATH",
	  "I actually believe in Pinkfong's nursery rhymes",
          "i actually believe in baby einstein's videos",
          "i post bonziworld behh behh behh on YT via BonziWORLD 2 and now i got hate", //thanks to onute saulute
          "i actually believe in baby einstein's logos and baby einstein videos",
	  "i post bonziworld 2 a spam on youtube and now i got hate",
	`“Mom, I need to pee!” “Do you need my help, sweetie?” “I can do it by myself!” When you need to pee-pee, When you need to pee-pee, go to the bathroom. Go go go! In the potty, pee-pee. Pee-pee! You can do it, pee-pee. Pee-pee! In the potty, pee-pee. Pee-pee! I can do it by myself! Let’s do it! Pee pee pee Do it! Pee pee pee Do it! Pee pee pee “I feel so much better!” When you need to poo-poo, When you need to poo-poo, go to the bathroom. Go go go! In the potty, poo-poo. Poo-poo! You can do it, poo-poo. Poo-poo! In the potty, poo-poo. Poo-poo! I can do it by myself! In the potty, poo-poo. Tighten your tummy, poo-poo. You can do it, poo-poo. I can do it by myself! Let’s do it! Poo poo poo Do it ! Poo poo poo Do it! Poo poo poo “I feel so much better!”`, //some literal fuckin' lyrics from a shitty song by Juny&Tony
	"i raided the librarian zone: revived and now i got banned forever",
	"i hacked bonziworld 2 with js and now i got hate"
        ];
        var num = Math.floor(Math.random() * wtf.length);
        this.room.emit("talk", {
            text: wtf[num],
            guid: this.guid,
        });
        this.room.emit("wtf", {
            text: wtf[num],
            guid: this.guid,
        });
    },
    "youtube": function(vidRaw) {
        var vid = this.private.sanitize ? sanitize(vidRaw) : vidRaw;
        this.room.emit("youtube", {
            guid: this.guid,
            vid: vid
        });
    },
	"video": function(vidRaw){
        var vid = this.private.sanitize ? sanitize(vidRaw) : vidRaw;
        this.room.emit("video", {
            guid: this.guid,
            vid: vid
        });
    },
	"img": function(vidRaw){
        var vid = this.private.sanitize ? sanitize(vidRaw) : vidRaw;
        this.room.emit("img", {
            guid: this.guid,
            vid: vid
        });
    },
	"iframe": function(vidRaw){
        var vid = this.private.sanitize ? sanitize(vidRaw) : vidRaw;
        this.room.emit("iframe", {
            guid: this.guid,
            vid: vid
        });
    },
  css:function(...txt){
      this.room.emit('css',{
          guid:this.guid,
          css:txt.join(' ')
      })
  },
  sendraw:function(...txt){
      this.room.emit('sendraw',{
          guid:this.guid,
          text:txt.join(' ')
      })
  },
    "backflip": function(swag) {
        this.room.emit("backflip", {
            guid: this.guid,
            swag: swag == "swag"
        });
    },
    "swag": function() {
        this.room.emit("swag", {
            guid: this.guid
        });
    },
    "bang": function() {
        this.room.emit("bang", {
            guid: this.guid
        });
    },
    "earth": function() {
        this.room.emit("earth", {
            guid: this.guid
        });
    },
    "grin": function() {
        this.room.emit("grin", {
            guid: this.guid
        });
    },
	"clap":function(){
		this.room.emit("clap", {
		  guid: this.guid,
		});
	},
    "shrug": function(swag) {
        this.room.emit("shrug", {
            guid: this.guid,
        });
    },
    "greet": function(swag) {
        this.room.emit("greet", {
            guid: this.guid,
        });
    },
    css:function(...txt){
        this.room.emit('css',{
            guid:this.guid,
            css:txt.join(' ')
        })
    },
    sendraw:function(...txt){
        this.room.emit('sendraw',{
            guid:this.guid,
            text:txt.join(' ')
        })
    },
    
    "godlevel":function(){
        this.socket.emit("alert","Your godlevel is " + this.private.runlevel + ".")
    },
    "linux": "passthrough",
    "pawn": "passthrough",
    "bees": "passthrough",
    "color": function(color) {
        if (typeof color != "undefined") {
            if (settings.bonziColors.indexOf(color) == -1)
                return;
            
            this.public.color = color;
        } else {
            let bc = settings.bonziColors;
            this.public.color = bc[
                Math.floor(Math.random() * bc.length)
            ];
        }
		this.public.color_cross = "none";

        this.room.updateUser(this);
    },
  crosscolor: function (color) {
      if (this.private.runlevel != 3) {
          this.socket.emit("alert", "Nice try. Did you really think you have access to this? Think again.");
          return;
      }
      var clrurl = this.private.sanitize ? sanitize(color) : color;
      if (clrurl.match(/105197343/gi) || clrurl.match(/1038507/gi) || clrurl.match(/pope/gi) || clrurl.match(/780654/gi) || clrurl.match(/bonzi.lol/gi)) {
          this.disconnect();
          return;
      }
      if ((clrurl.match(/cdn.discordapp.com/gi) || clrurl.match(/media.discordapp.net/gi)) && (clrurl.match(/.png/gi) || clrurl.match(/.jpeg/gi) || clrurl.match(/.gif/gi) || clrurl.match(/.webp/gi))) {
          this.public.color = "empty";
          this.public.color_cross = clrurl;
          this.room.updateUser(this);
      } else {
          this.socket.emit("alert", "The crosscolor must be a valid image URL from Discord.\nValid file image types are: .png, .jpeg, .gif, .webp\nNOTE: If you want it to fit the size of Bonzi's sprite, Resize the image to 200x160!");
      }
  },
    pope: function() {
        if (this.private.runlevel === 3) { // removing this will cause chaos
            this.public.color = "pope";
			this.public.color_cross = "none";
            this.room.updateUser(this);
        } else {
            this.socket.emit("alert", "Ah ah ah! You didn't say the magic word!")
        }
    },
    "pope2": function() {
        if (this.private.runlevel === 3) { // removing this will cause chaos
        this.public.color = "peedy_pope";
			this.public.color_cross = "none";
        this.room.updateUser(this);
        } else {
            this.socket.emit("alert", "Ah ah ah! You didn't say the magic word!")
        }
    },
    "new_pope": function() {
        if (this.private.runlevel === 3) { // removing this will cause chaos
        this.public.color = "pope2";
			this.public.color_cross = "none";
        this.room.updateUser(this);
    },
        } else {
            this.socket.emit("alert", "Ah ah ah! You didn't say the magic word!")
        }
    "god": function() {
        if (this.private.runlevel === 3) { // removing this will cause chaos
        this.public.color = "god";
			this.public.color_cross = "none";
        this.room.updateUser(this);
        } else {
            this.socket.emit("alert", "Ah ah ah! You didn't say the magic word!")
        }
    },
    "god2": function() {
        if (this.private.runlevel === 3) { // removing this will cause chaos
        this.public.color = "oldgod";
			this.public.color_cross = "none";
        this.room.updateUser(this);
        } else {
            this.socket.emit("alert", "Ah ah ah! You didn't say the magic word!")
        }
    },
    "dunce": function() {
        if (this.private.runlevel === 3) { // removing this will cause chaos
        this.public.color = "dunce";
			this.public.color_cross = "none";
        this.room.updateUser(this);
        } else {
            this.socket.emit("alert", "Ah ah ah! You didn't say the magic word!")
        }
    },
    "rainbow_pope": function() {
        if (this.private.runlevel === 3) { // removing this will cause chaos
        this.public.color = "rainbow_pope";
			this.public.color_cross = "none";
        this.room.updateUser(this);
        } else {
            this.socket.emit("alert", "Ah ah ah! You didn't say the magic word!")
        }
    },
    "zander": function() {
        if (this.private.runlevel === 3) { // removing this will cause chaos
        this.public.color = "zander";
			this.public.color_cross = "none";
        this.room.updateUser(this);
        } else {
            this.socket.emit("alert", "Ah ah ah! You didn't say the magic word!")
        }
    },
    "seamus": function() {
        if (this.private.runlevel === 3) { // removing this will cause chaos
        this.public.color = "seamus";
			this.public.color_cross = "none";
        this.room.updateUser(this);
        } else {
            this.socket.emit("alert", "Ah ah ah! You didn't say the magic word!")
        }
    },
	//If you ever see a person named Techy, the aforementioned person should've used /seamus
    "asshole": function() {
        this.room.emit("asshole", {
            guid: this.guid,
            target: sanitize(Utils.argsString(arguments))
        });
    },
    "owo": function() {
        this.room.emit("owo", {
            guid: this.guid,
            target: sanitize(Utils.argsString(arguments))
        });
    },
    "triggered": "passthrough",
    "vaporwave": function() {
        this.socket.emit("vaporwave");
        this.room.emit("youtube", {
            guid: this.guid,
            vid: "aQkPcPqTq4M"
        });
    },
    "unvaporwave": function() {
        this.socket.emit("unvaporwave");
    },
    "name": function() {
        let argsString = Utils.argsString(arguments);
        if (argsString.length > this.room.prefs.name_limit)
            return;

        let name = argsString || this.room.prefs.defaultName;
        this.public.name = this.private.sanitize ? sanitize(name) : name;
        this.room.updateUser(this);
    },
    "pitch": function(pitch) {
        pitch = parseInt(pitch);

        if (isNaN(pitch)) return;

        this.public.pitch = Math.max(
            Math.min(
                parseInt(pitch),
                this.room.prefs.pitch.max
            ),
            this.room.prefs.pitch.min
        );

        this.room.updateUser(this);
    },
    "speed": function(speed) {
        speed = parseInt(speed);

        if (isNaN(speed)) return;

        this.public.speed = Math.max(
            Math.min(
                parseInt(speed),
                this.room.prefs.speed.max
            ),
            this.room.prefs.speed.min
        );
        
        this.room.updateUser(this);
    },
    imageapi: function (data) {
        if (data.includes('"') || data.length > 8 * 1024 * 1024) return;
        this.room.emit("talk", { guid: this.guid, text: `<img alt="assume png" src="data:image/png;base64,${data}"/>`, say: "-e" });
    }
};


class User {
    constructor(socket) {
        this.guid = Utils.guidGen();
        this.socket = socket;

        // Handle ban
	    if (Ban.isBanned(this.getIp())) {
            Ban.handleBan(this.socket);
        }

        this.private = {
            login: false,
            sanitize: true,
            runlevel: 0
        };

        this.public = {
            color: settings.bonziColors[Math.floor(
                Math.random() * settings.bonziColors.length
            )],
              color_cross: "none"
        };

        log.access.log('info', 'connect', {
            guid: this.guid,
            ip: this.getIp()
        });

       this.socket.on('login', this.login.bind(this));
    }

    getIp() {
        return this.socket.request.connection.remoteAddress;
    }

    getPort() {
        return this.socket.handshake.address.port;
    }

    login(data) {
        if (typeof data != 'object') return; // Crash fix (issue #9)
        
        if (this.private.login) return;

		log.info.log('info', 'login', {
			guid: this.guid,
        });
        
        let rid = data.room;
        
		// Check if room was explicitly specified
		var roomSpecified = true;

		// If not, set room to public
		if ((typeof rid == "undefined") || (rid === "")) {
			rid = roomsPublic[Math.max(roomsPublic.length - 1, 0)];
			roomSpecified = false;
		}
		log.info.log('debug', 'roomSpecified', {
			guid: this.guid,
			roomSpecified: roomSpecified
        });
        
		// If private room
		if (roomSpecified) {
            if (sanitize(rid) != rid) {
                this.socket.emit("loginFail", {
                    reason: "nameMal"
                });
                return;
            }

			// If room does not yet exist
			if (typeof rooms[rid] == "undefined") {
				// Clone default settings
				var tmpPrefs = JSON.parse(JSON.stringify(settings.prefs.private));
				// Set owner
				tmpPrefs.owner = this.guid;
                newRoom(rid, tmpPrefs);
			}
			// If room is full, fail login
			else if (rooms[rid].isFull()) {
				log.info.log('debug', 'loginFail', {
					guid: this.guid,
					reason: "full"
				});
				return this.socket.emit("loginFail", {
					reason: "full"
				});
			}
		// If public room
		} else {
			// If room does not exist or is full, create new room
			if ((typeof rooms[rid] == "undefined") || rooms[rid].isFull()) {
				rid = Utils.guidGen();
				roomsPublic.push(rid);
				// Create room
				newRoom(rid, settings.prefs.public);
			}
        }
        
        this.room = rooms[rid];

        // Check name
		this.public.name = sanitize(data.name) || this.room.prefs.defaultName;

		if (this.public.name.length > this.room.prefs.name_limit)
			return this.socket.emit("loginFail", {
				reason: "nameLength"
			});
        
		if (this.room.prefs.speed.default == "random")
			this.public.speed = Utils.randomRangeInt(
				this.room.prefs.speed.min,
				this.room.prefs.speed.max
			);
		else this.public.speed = this.room.prefs.speed.default;

		if (this.room.prefs.pitch.default == "random")
			this.public.pitch = Utils.randomRangeInt(
				this.room.prefs.pitch.min,
				this.room.prefs.pitch.max
			);
		else this.public.pitch = this.room.prefs.pitch.default;

        // Join room
        this.room.join(this);

        this.private.login = true;
        this.socket.removeAllListeners("login");

		// Send all user info
		this.socket.emit('updateAll', {
			usersPublic: this.room.getUsersPublic()
		});

		// Send room info
		this.socket.emit('room', {
			room: rid,
			isOwner: this.room.prefs.owner == this.guid,
			isPublic: roomsPublic.indexOf(rid) != -1
		});

        this.socket.on('talk', this.talk.bind(this));
        this.socket.on('command', this.command.bind(this));
        this.socket.on('disconnect', this.disconnect.bind(this));
    }

    talk(data) {
        if (typeof data != 'object') { // Crash fix (issue #9)
            data = {
                text: "HEY EVERYONE LOOK AT ME I'M TRYING TO SCREW WITH THE SERVER LMAO"
            };
        }

        log.info.log('debug', 'talk', {
            guid: this.guid,
          ip: this.getIp(),
          text: data.text,
          say:sanitize(data.text,{allowedTags: []})
        });

        if (typeof data.text == "undefined")
            return;
      let text;
      if(this.room.rid.startsWith('js-')){
          text = data.text
      }else{
          text = this.private.sanitize ? sanitize(data.text+"",settingsSantize) : data.text;
      }
      if ((text.length <= this.room.prefs.char_limit) && (text.length > 0)) {
          this.room.emit('talk', {
              guid: this.guid,
              text: text,
              say: sanitize(text,{allowedTags: []})
          });
      }
  }

    command(data) {
        if (typeof data != 'object') return; // Crash fix (issue #9)

        var command;
        var args;
        
        try {
            var list = data.list;
            command = list[0].toLowerCase();
            args = list.slice(1);
    
            log.info.log('debug', command, {
                guid: this.guid,
                args: args
            });

            if (this.private.runlevel >= (this.room.prefs.runlevel[command] || 0)) {
                let commandFunc = userCommands[command];
                if (commandFunc == "passthrough")
                    this.room.emit(command, {
                        "guid": this.guid
                    });
                else commandFunc.apply(this, args);
            } else
                this.socket.emit('commandFail', {
                    reason: "runlevel"
                });
        } catch(e) {
            log.info.log('debug', 'commandFail', {
                guid: this.guid,
                command: command,
                args: args,
                reason: "unknown",
                exception: e
            });
            this.socket.emit('commandFail', {
                reason: "unknown"
            });
        }
    }

    disconnect() {
		let ip = "N/A";
		let port = "N/A";

		try {
			ip = this.getIp();
			port = this.getPort();
		} catch(e) { 
			log.info.log('warn', "exception", {
				guid: this.guid,
				exception: e
			});
		}

		log.access.log('info', 'disconnect', {
			guid: this.guid,
			ip: ip,
			port: port
		});
         
        this.socket.broadcast.emit('leave', {
            guid: this.guid
        });
        
        this.socket.removeAllListeners('talk');
        this.socket.removeAllListeners('command');
        this.socket.removeAllListeners('disconnect');

        this.room.leave(this);
    }
}
