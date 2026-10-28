# lol-coach

Coach League of Legends pour notre groupe de potes. Il analyse tes dernières parties classées et te dit :

- **une note sur 10** à la fin de chaque partie, avec chaque + et chaque − et sa minute (kills, morts, ganks, objectifs, farm, vision) ;
- **à quel moment la partie a été perdue** (ou gagnée), et ce que tu faisais à ce moment-là ;
- **chacune de tes morts** : seul ou en équipe, combien d'ennemis, et l'objectif perdu juste après ;
- **les stats de ton rôle** comparées à ton vis-à-vis : farm à 10 min, or à 15 min, vision, ganks et objectifs pour la jungle, roams pour le mid ;
- **chacun de tes ganks** (en jungle) : réussi, raté ou sans résultat, et pourquoi (contre-gank, lane en retard de niveaux, laner absent, infériorité numérique) ;
- **les erreurs qui reviennent** dans au moins 30 % de tes parties, avec un conseil concret pour chacune.

## App PC (à côté du jeu)

Télécharge `LoL Coach Setup.exe` (ou la version portable) dans la page [Releases](../../releases/latest), puis lance-le. Windows peut afficher « Windows a protégé votre ordinateur » parce que l'app n'est pas signée : clique sur **Informations complémentaires**, puis **Exécuter quand même**.

Il n'y a rien à configurer : ni clé API, ni pseudo. L'app lit tout dans ton client LoL :

- elle se connecte toute seule au client et reconnaît le compte connecté ;
- pendant la sélection des champions, conseille des bans et des picks (en tenant compte de ta maîtrise de chaque champion et des picks qui se font counter tant que ton adversaire n'a pas choisi) selon tes résultats récents, ce qui manque à ton équipe et tes résultats contre les champions d'en face, plus des conseils d'objets selon leur compo ;
- garde ces infos affichées pendant la partie (Alt-Tab ou 2e écran) ;
- analyse ta partie automatiquement à la fin.

### Écran de chargement

Pour les 10 joueurs, lus dans ton client : rang, winrate de la saison, série en cours, et expérience récente sur le champion joué (« pas joué récemment », « one-trick »).

### Jungler adverse

À l'écran de chargement, l'app lit les dernières ranked du jungler adverse en jungle et affiche ses habitudes :

- le côté où il commence et s'il envahit au niveau 1 ;
- où il est à 4:00 ;
- la lane et le moment de son premier gank ;
- le premier objectif que prend son équipe ;
- où et quand poser ta balise.

Ce sont ses habitudes passées, pas sa position réelle : l'app ne lit rien du jeu en cours et ne donne aucune info en direct.

### Stats de tout le serveur

Pour conseiller contre n'importe quelle équipe, GitHub récolte chaque jour des milliers de ranked solo/duo de joueurs Émeraude et plus sur EUW (`.github/workflows/stats.yml`). Il en tire :

- le winrate de chaque champion à chaque poste ;
- les counters et les duos : comment chaque champion s'en sort contre et avec chaque autre champion ;
- le build et la rune principale des joueurs selon que l'équipe d'en face fait surtout des dégâts physiques, magiques ou mixtes.

L'app télécharge ces stats toute seule, aucune clé n'est à saisir. Les conseils les utilisent dès 1 000 parties. À chaque nouveau patch, les stats repartent de zéro, et celles du patch précédent servent en attendant.

**Mise en place (une seule fois, par le propriétaire du repo)** : demander une clé « Personal » sur [developer.riotgames.com](https://developer.riotgames.com), puis l'ajouter dans *Settings → Secrets and variables → Actions → New repository secret*, sous le nom `RIOT_API_KEY`. La récolte tourne ensuite chaque nuit. On peut aussi la lancer à la main depuis l'onglet *Actions*, avec *Stats du serveur* puis *Run workflow*.

Elle n'affiche rien par-dessus le jeu et ne donne aucune info cachée (timers ennemis, etc.), conformément aux règles de Riot.

## Ligne de commande

### Lancer une analyse (Windows)

1. Installe [Node.js](https://nodejs.org) (version LTS), puis redémarre ton PC.
2. Télécharge ce repo : bouton vert **Code**, puis **Download ZIP**, et décompresse-le.
3. Ouvre le dossier, clique dans la barre d'adresse de l'explorateur, tape `cmd` et appuie sur Entrée.
4. Une seule fois, tape : `npm install`
5. Crée un fichier `.env` dans le dossier avec ta clé de [developer.riotgames.com](https://developer.riotgames.com) :
   ```
   RIOT_API_KEY=RGAPI-xxxxxxxx
   RIOT_ID=TonPseudo#EUW
   ```
   Avec le Bloc-notes, choisis « Tous les fichiers » à l'enregistrement, sinon il devient `.env.txt`. Ce fichier reste sur ton PC et n'est jamais envoyé sur GitHub. La clé de développement expire après 24 h, il faut la régénérer sur le site.
6. Lance l'analyse : double-clique sur `analyser.bat`, ou tape `npm run analyse` dans la fenêtre noire.
   Pour analyser quelqu'un d'autre sans changer le `.env` : `npm run analyse -- "SonPseudo#TAG"`.

Le rapport s'affiche et il est aussi enregistré dans le dossier `rapports/`.

Options :

- `--parties 30` : nombre de parties à analyser (20 par défaut) ;
- `--type normal` : parties normales au lieu des classées ;
- `--serveur na1` : autre serveur qu'EUW.

## Pour les développeurs

```
npm test          # tests sur des parties et des drafts synthétiques
npm run typecheck
npm run app       # lance l'app PC en local
npm run dist      # construit l'installeur Windows dans release/
```

- `app/` : app Electron (processus principal, fenêtre).
- `src/lcu/` : connexion à l'API locale du client LoL, et lecture de l'historique et des timelines (converties au format Match-V5).
- `src/draft/` : pool de champions, conseils de pick et de build.
- `src/scout/` : habitudes de début de partie du jungler adverse.
- `src/collect.ts` : récolte quotidienne lancée par GitHub Actions.
- `src/global/` : récolte des parties du serveur et stats agrégées (winrates, counters, duos, builds).
- `src/data/` : données des champions (Data Dragon).

- `src/riot/` : client de l'API Riot (Account-V1, Match-V5) avec cache disque des parties.
- `src/analysis/` : découpage de la partie en actions, analyse des morts, stats par rôle, erreurs récurrentes.
- `src/report/` : rapport en français.

Les valeurs en or des objectifs (`src/analysis/plays.ts`) sont des estimations qui servent à comparer les actions entre elles.
