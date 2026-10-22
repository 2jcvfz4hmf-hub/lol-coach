# lol-coach

Coach League of Legends pour notre groupe de potes. Il analyse tes dernières parties classées et te dit :

- **à quel moment la partie a été perdue** (ou gagnée), et ce que tu faisais à ce moment-là ;
- **chacune de tes morts** : seul ou en équipe, combien d'ennemis, et l'objectif perdu juste après ;
- **les stats de ton rôle** comparées à ton vis-à-vis : farm à 10 min, or à 15 min, vision, ganks et objectifs pour la jungle, roams pour le mid ;
- **les erreurs qui reviennent** dans au moins 30 % de tes parties, avec un conseil concret pour chacune.

Ce n'est que la V1, en ligne de commande. L'app PC avec l'aide à la draft et les builds adaptés à la partie arrivera ensuite.

## Lancer une analyse (Windows)

1. Installe [Node.js](https://nodejs.org) (version LTS), puis redémarre ton PC.
2. Télécharge ce repo : bouton vert **Code**, puis **Download ZIP**, et décompresse-le.
3. Ouvre le dossier, clique dans la barre d'adresse de l'explorateur, tape `cmd` et appuie sur Entrée.
4. Une seule fois, tape : `npm install`
5. Crée un fichier `.env` dans le dossier avec ta clé de [developer.riotgames.com](https://developer.riotgames.com) :
   ```
   RIOT_API_KEY=RGAPI-xxxxxxxx
   ```
   Avec le Bloc-notes, choisis « Tous les fichiers » à l'enregistrement, sinon il devient `.env.txt`. Ce fichier reste sur ton PC et n'est jamais envoyé sur GitHub. La clé de développement expire après 24 h, il faut la régénérer sur le site.
6. Lance l'analyse :
   ```
   npm run analyse -- "TonPseudo#EUW"
   ```

Le rapport s'affiche et il est aussi enregistré dans le dossier `rapports/`.

Options :

- `--parties 30` : nombre de parties à analyser (20 par défaut) ;
- `--type normal` : parties normales au lieu des classées ;
- `--serveur na1` : autre serveur qu'EUW.

## Pour les développeurs

```
npm test          # tests de l'analyse sur des parties synthétiques
npm run typecheck
```

- `src/riot/` : client de l'API Riot (Account-V1, Match-V5) avec cache disque des parties.
- `src/analysis/` : découpage de la partie en actions, analyse des morts, stats par rôle, erreurs récurrentes.
- `src/report/` : rapport en français.

Les valeurs en or des objectifs (`src/analysis/plays.ts`) sont des estimations qui servent à comparer les actions entre elles.
