// Interface language (de / en / es / it). The app is written in German; this layer translates the rendered
// interface: text nodes and placeholder / aria-label / title attributes, live as pages change.
// Entries: "Deutsch|English|Español|Italiano". Data people type (names, notes, exercises) is left alone.
(function () {
  'use strict';

  const LANGS = ['de', 'en', 'es', 'it'];
  const LOCALES = { de: 'de-DE', en: 'en-GB', es: 'es-ES', it: 'it-IT' };

  const RAW = `
Tracker|Tracker|Tracker|Tracker
Training|Training|Entreno|Allenamento
Ernährung|Nutrition|Nutrición|Alimentazione
Nachrichten|Messages|Mensajes|Messaggi
Einstellungen|Settings|Ajustes|Impostazioni
Klienten|Clients|Clientes|Clienti
Check-in|Check-in|Check-in|Check-in
Admin|Admin|Admin|Admin
Konto|Account|Cuenta|Account
Abmelden|Log out|Cerrar sesión|Esci
Profil|Profile|Perfil|Profilo
Hall of Fame|Hall of Fame|Salón de la fama|Hall of Fame
Medaillen|Medals|Medallas|Medaglie
Kühlschrank|Fridge|Nevera|Frigo
Shop|Shop|Tienda|Negozio
Konto-Menü|Account menu|Menú de cuenta|Menu account
Hauptnavigation|Main navigation|Navegación principal|Navigazione principale
Lädt|Loading|Cargando|Caricamento
Lade…|Loading…|Cargando…|Caricamento…
StayOnTrack lädt|StayOnTrack is loading|StayOnTrack se está cargando|StayOnTrack si sta caricando
Anmelden|Log in|Iniciar sesión|Accedi
Benutzername|Username|Usuario|Nome utente
Passwort|Password|Contraseña|Password
Gewicht, Schritte, Schlaf und Ernährung an einem Ort. Dein Coach sieht mit – du bleibst dran.|Weight, steps, sleep and nutrition in one place. Your coach follows along – you stay on track.|Peso, pasos, sueño y nutrición en un solo lugar. Tu coach lo ve contigo – tú sigues en marcha.|Peso, passi, sonno e alimentazione in un unico posto. Il tuo coach segue con te – tu resti in carreggiata.
StayOnTrack · Coaching|StayOnTrack · Coaching|StayOnTrack · Coaching|StayOnTrack · Coaching
Guten Morgen|Good morning|Buenos días|Buongiorno
Guten Mittag|Good afternoon|Buenas tardes|Buon pomeriggio
Schönen Nachmittag|Good afternoon|Buenas tardes|Buon pomeriggio
Guten Abend|Good evening|Buenas noches|Buonasera
Gute Nacht|Good night|Buenas noches|Buonanotte
Heute|Today|Hoy|Oggi
Tag eintragen|Log today|Registrar el día|Registra la giornata
Eintrag ergänzen|Complete entry|Completar registro|Completa la registrazione
offen|open|pendiente|aperto
Gewicht|Weight|Peso|Peso
Schritte|Steps|Pasos|Passi
Schlaf|Sleep|Sueño|Sonno
Kalorien|Calories|Calorías|Calorie
eingehalten|on plan|cumplidas|rispettate
nicht eingehalten|not on plan|no cumplidas|non rispettate
Ja|Yes|Sí|Sì
Nein|No|No|No
Verlauf|History|Historial|Andamento
Alle Einträge|All entries|Todos los registros|Tutte le registrazioni
Anzeigen|Show|Mostrar|Mostra
Ausblenden|Hide|Ocultar|Nascondi
Tageseintrag|Daily entry|Registro diario|Registrazione giornaliera
noch offen|still open|pendiente|ancora aperto
gespeichert|saved|guardado|salvato
Schließen|Close|Cerrar|Chiudi
Datum|Date|Fecha|Data
Schlaf (letzte Nacht)|Sleep (last night)|Sueño (anoche)|Sonno (stanotte)
Std.|h|h|h
Min.|min|min|min
Trainingstag?|Training day?|¿Día de entreno?|Giorno di allenamento?
Kalorien laut Plan eingehalten?|Calories on plan?|¿Calorías según el plan?|Calorie secondo il piano?
Wie viel hast du gegessen?|How much did you eat?|¿Cuánto has comido?|Quanto hai mangiato?
Notiz|Note|Nota|Nota
(optional)|(optional)|(opcional)|(facoltativo)
Wie lief der Tag? Training, Ernährung, Befinden…|How was your day? Training, food, how you feel…|¿Qué tal el día? Entreno, comida, cómo te sientes…|Com'è andata la giornata? Allenamento, cibo, come stai…
Speichern|Save|Guardar|Salva
Gespeichert|Saved|Guardado|Salvato
Du kannst jeden Wert auch später am Tag ergänzen – bereits gespeicherte Werte bleiben erhalten.|You can add any value later in the day – values you saved stay.|Puedes completar cualquier valor más tarde – lo guardado se mantiene.|Puoi aggiungere ogni valore più tardi – quelli salvati restano.
z. B. 82,4|e.g. 82.4|p. ej. 82,4|es. 82,4
z. B. 8500|e.g. 8500|p. ej. 8500|es. 8500
z. B. 2650|e.g. 2650|p. ej. 2650|es. 2650
Tage in Folge eingetragen|days logged in a row|días seguidos registrados|giorni di fila registrati
Gewicht – 14 Tage|Weight – 14 days|Peso – 14 días|Peso – 14 giorni
Schritte pro Tag|Steps per day|Pasos por día|Passi al giorno
Schlaf pro Nacht|Sleep per night|Sueño por noche|Sonno per notte
Tageswert|Daily value|Valor diario|Valore giornaliero
Ø 7 Tage|7-day avg|Media 7 días|Media 7 giorni
Mittelwert|Average|Media|Media
Range|Range|Rango|Intervallo
Ziel erreicht|Goal reached|Objetivo alcanzado|Obiettivo raggiunto
Training|Training|Entreno|Allenamento
× in 7 Tagen|× in 7 days|× en 7 días|× in 7 giorni
Keine Einträge in diesem Zeitraum.|No entries in this period.|No hay registros en este periodo.|Nessuna registrazione in questo periodo.
Bearbeiten|Edit|Editar|Modifica
Löschen|Delete|Eliminar|Elimina
Eintrag gelöscht|Entry deleted|Registro eliminado|Registrazione eliminata
Zeitraum der Diagramme|Chart period|Periodo de los gráficos|Periodo dei grafici
Alle|All|Todo|Tutto
Noch kein Wert|No value yet|Aún sin valor|Ancora nessun valore
Vorgabe|Target|Objetivo|Obiettivo
Keine Vorgabe|No target|Sin objetivo|Nessun obiettivo
📋 Check-in von deinem Coach|📋 Check-in from your coach|📋 Check-in de tu coach|📋 Check-in dal tuo coach
Vorgeschlagene Anpassungen für deinen Plan|Suggested changes to your plan|Cambios propuestos para tu plan|Modifiche proposte al tuo piano
✓ Anpassungen annehmen|✓ Accept changes|✓ Aceptar cambios|✓ Accetta modifiche
Antworten|Reply|Responder|Rispondi
Deine Antwort an den Coach…|Your reply to your coach…|Tu respuesta al coach…|La tua risposta al coach…
Antwort senden|Send reply|Enviar respuesta|Invia risposta
Anpassungen angenommen – dein Plan ist aktualisiert ✓|Changes accepted – your plan is updated ✓|Cambios aceptados – tu plan está actualizado ✓|Modifiche accettate – il tuo piano è aggiornato ✓
Highlights deiner Woche|Highlights of your week|Lo mejor de tu semana|I momenti migliori della settimana
🔔 Erinnerungen & Nachrichten von deinem Coach aufs Handy?|🔔 Reminders & messages from your coach on your phone?|🔔 ¿Recordatorios y mensajes de tu coach en el móvil?|🔔 Promemoria e messaggi del coach sul telefono?
Ja, aktivieren|Yes, turn on|Sí, activar|Sì, attiva
Später|Later|Más tarde|Più tardi
Nein danke|No thanks|No, gracias|No grazie
Push-Benachrichtigungen|Push notifications|Notificaciones push|Notifiche push
Erinnerungen deines Coaches und neue Chat-Nachrichten direkt aufs Handy.|Your coach's reminders and new chat messages straight to your phone.|Recordatorios de tu coach y nuevos mensajes directamente en tu móvil.|Promemoria del coach e nuovi messaggi direttamente sul telefono.
Benachrichtigungen aktivieren|Turn on notifications|Activar notificaciones|Attiva notifiche
Benachrichtigungen aktiviert ✓|Notifications on ✓|Notificaciones activadas ✓|Notifiche attivate ✓
Deaktivieren|Turn off|Desactivar|Disattiva
Test senden|Send test|Enviar prueba|Invia prova
Aktiv auf diesem Gerät|Active on this device|Activo en este dispositivo|Attivo su questo dispositivo
Von diesem Browser nicht unterstützt|Not supported by this browser|No compatible con este navegador|Non supportato da questo browser
Erst zum Home-Bildschirm hinzufügen|Add to home screen first|Primero añádelo a la pantalla de inicio|Prima aggiungi alla schermata Home
Darstellung|Appearance|Apariencia|Aspetto
Gilt für dein Konto auf allen Geräten.|Applies to your account on all devices.|Se aplica a tu cuenta en todos los dispositivos.|Vale per il tuo account su tutti i dispositivi.
Sprache|Language|Idioma|Lingua
Erscheinungsbild|Theme|Tema|Tema
System|System|Sistema|Sistema
Hell|Light|Claro|Chiaro
Dunkel|Dark|Oscuro|Scuro
Liquid Glass|Liquid Glass|Liquid Glass|Liquid Glass
Gläserne, durchscheinende Leisten und Menüs – angelehnt an das aktuelle iOS-Design.|Glassy, translucent bars and menus – inspired by the latest iOS design.|Barras y menús de cristal translúcido – inspirado en el diseño actual de iOS.|Barre e menu in vetro traslucido – ispirati all'attuale design di iOS.
An|On|Sí|On
Aus|Off|No|Off
Dein Profil|Your profile|Tu perfil|Il tuo profilo
Coach|Coach|Coach|Coach
Profilbild|Profile picture|Foto de perfil|Foto profilo
Bild wählen|Choose picture|Elegir imagen|Scegli immagine
Entfernen|Remove|Quitar|Rimuovi
Sieht nur dein Coach.|Only your coach sees it.|Solo la ve tu coach.|La vede solo il tuo coach.
Name|Name|Nombre|Nome
Damit meldest du dich an. 3–32 Zeichen: Buchstaben, Ziffern, . _ -|You log in with this. 3–32 characters: letters, digits, . _ -|Con esto inicias sesión. 3–32 caracteres: letras, números, . _ -|Serve per accedere. 3–32 caratteri: lettere, cifre, . _ -
Ändere dein Passwort regelmäßig und nutze es nirgendwo sonst.|Change your password regularly and don't use it anywhere else.|Cambia tu contraseña con regularidad y no la uses en otro sitio.|Cambia la password regolarmente e non usarla altrove.
Passwort ändern|Change password|Cambiar contraseña|Cambia password
Aktuelles Passwort|Current password|Contraseña actual|Password attuale
Neues Passwort|New password|Nueva contraseña|Nuova password
Mindestens 8 Zeichen|At least 8 characters|Mínimo 8 caracteres|Almeno 8 caratteri
Passwort geändert|Password changed|Contraseña cambiada|Password cambiata
Profilbild gespeichert|Profile picture saved|Foto de perfil guardada|Foto profilo salvata
Profilbild entfernt|Profile picture removed|Foto de perfil eliminada|Foto profilo rimossa
Abbrechen|Cancel|Cancelar|Annulla
Nachricht schreiben…|Write a message…|Escribe un mensaje…|Scrivi un messaggio…
Senden|Send|Enviar|Invia
Noch keine Nachrichten|No messages yet|Aún no hay mensajes|Ancora nessun messaggio
Du:|You:|Tú:|Tu:
Ernährungsplan|Nutrition plan|Plan de nutrición|Piano alimentare
Von deinem Coach|From your coach|De tu coach|Dal tuo coach
Du kannst einzelne Lebensmittel oder ganze Mahlzeiten zum Tausch anfragen – dein Coach entscheidet.|You can request swaps for single foods or whole meals – your coach decides.|Puedes pedir cambiar alimentos o comidas enteras – tu coach decide.|Puoi chiedere di sostituire singoli alimenti o pasti interi – decide il coach.
⇄ Tauschen|⇄ Swap|⇄ Cambiar|⇄ Sostituisci
Tausch angefragt|Swap requested|Cambio solicitado|Sostituzione richiesta
Ganze Mahlzeit tauschen anfragen|Request swapping the whole meal|Pedir cambiar la comida entera|Chiedi di sostituire l'intero pasto
Tausch der ganzen Mahlzeit angefragt|Whole-meal swap requested|Cambio de la comida entera solicitado|Sostituzione dell'intero pasto richiesta
Meine Tauschwünsche|My swap requests|Mis solicitudes de cambio|Le mie richieste
Dein Coach erstellt gerade deinen Ernährungsplan.|Your coach is creating your nutrition plan.|Tu coach está creando tu plan de nutrición.|Il tuo coach sta creando il tuo piano alimentare.
Wogegen möchtest du tauschen?|What would you like instead?|¿Por qué quieres cambiarlo?|Con cosa vuoi sostituirlo?
Was möchtest du stattdessen essen?|What would you rather eat?|¿Qué prefieres comer en su lugar?|Cosa preferiresti mangiare?
Anfrage senden|Send request|Enviar solicitud|Invia richiesta
Zurückziehen|Withdraw|Retirar|Ritira
✓ Angenommen|✓ Accepted|✓ Aceptado|✓ Accettato
✗ Abgelehnt|✗ Declined|✗ Rechazado|✗ Rifiutato
Lebensmittel suchen|Search foods|Buscar alimentos|Cerca alimenti
Keine Treffer.|No results.|Sin resultados.|Nessun risultato.
Dein Trainingsplan|Your training plan|Tu plan de entreno|Il tuo piano di allenamento
Trainingsplan|Training plan|Plan de entreno|Piano di allenamento
Neu|New|Nuevo|Nuovo
Noch kein Plan. In zwei Schritten zu deinem Standardplan – danach kannst du alles anpassen.|No plan yet. Two steps to your standard plan – then you can adjust everything.|Aún no hay plan. Dos pasos hasta tu plan estándar – luego puedes ajustarlo todo.|Ancora nessun piano. Due passi per il tuo piano standard – poi puoi modificare tutto.
Wie oft pro Woche trainieren?|How often per week?|¿Cuántas veces por semana?|Quante volte a settimana?
Welcher Split?|Which split?|¿Qué split?|Quale split?
Tage|days|días|giorni
Passt|Fits|Encaja|Adatto
Frei|Free|Libre|Libero
Eigener Split|Custom split|Split propio|Split personalizzato
Ganzkörper|Full body|Cuerpo completo|Total body
Arnold-Split|Arnold split|Split Arnold|Split Arnold
Bro-Split|Bro split|Bro split|Bro split
Jede Muskelgruppe in jedem Training – ideal für Einsteiger und wenig Zeit.|Every muscle group every session – ideal for beginners and busy weeks.|Todos los grupos musculares en cada sesión – ideal para principiantes y poco tiempo.|Ogni gruppo muscolare in ogni seduta – ideale per principianti e poco tempo.
Oberkörper und Unterkörper im Wechsel, jede Muskelgruppe 2× pro Woche.|Upper and lower body alternate, each muscle group 2× per week.|Tren superior e inferior alternos, cada grupo 2× por semana.|Parte alta e bassa alternate, ogni gruppo 2× a settimana.
Drücken, Ziehen, Beine. Mit 6 Tagen jede Muskelgruppe 2× pro Woche.|Push, pull, legs. With 6 days every muscle group 2× per week.|Empuje, tirón, piernas. Con 6 días cada grupo 2× por semana.|Spinta, trazione, gambe. Con 6 giorni ogni gruppo 2× a settimana.
Rumpf (Brust, Rücken, Bauch) und Extremitäten (Beine, Arme, Seitliche Schulter).|Torso (chest, back, abs) and limbs (legs, arms, side delts).|Torso (pecho, espalda, abdomen) y extremidades (piernas, brazos, deltoides laterales).|Busto (petto, schiena, addome) e arti (gambe, braccia, deltoidi laterali).
Hybrid für 5 Tage: Upper, Lower, dann Push, Pull, Legs.|5-day hybrid: upper, lower, then push, pull, legs.|Híbrido de 5 días: superior, inferior, luego empuje, tirón, piernas.|Ibrido da 5 giorni: alta, bassa, poi spinta, trazione, gambe.
Brust & Rücken, Schultern & Arme, Beine – klassisch mit 6 Tagen.|Chest & back, shoulders & arms, legs – classically 6 days.|Pecho y espalda, hombros y brazos, piernas – clásico con 6 días.|Petto e schiena, spalle e braccia, gambe – classico con 6 giorni.
Ein Muskel pro Tag: Brust, Rücken, Schultern, Beine, Arme.|One muscle per day: chest, back, shoulders, legs, arms.|Un músculo por día: pecho, espalda, hombros, piernas, brazos.|Un muscolo al giorno: petto, schiena, spalle, gambe, braccia.
Tage selbst benennen und Übungen frei zusammenstellen.|Name your days and pick exercises freely.|Nombra tus días y elige los ejercicios libremente.|Dai un nome ai giorni e scegli liberamente gli esercizi.
Plan bearbeiten|Edit plan|Editar plan|Modifica piano
Benenne die Tage, passe Übungen an und füge mit + neue hinzu. Gespeichert wird unten.|Name the days, adjust exercises and add new ones with +. Save at the bottom.|Nombra los días, ajusta ejercicios y añade nuevos con +. Se guarda abajo.|Dai un nome ai giorni, modifica gli esercizi e aggiungine con +. Si salva in basso.
Split wechseln|Change split|Cambiar split|Cambia split
Übung|Exercise|Ejercicio|Esercizio
Sätze|Sets|Series|Serie
Wdh.|Reps|Reps|Rip.
Übung hinzufügen|Add exercise|Añadir ejercicio|Aggiungi esercizio
+ Trainingstag hinzufügen|+ Add training day|+ Añadir día de entreno|+ Aggiungi giorno
Plan speichern|Save plan|Guardar plan|Salva piano
Noch keine Übungen.|No exercises yet.|Aún no hay ejercicios.|Ancora nessun esercizio.
Training starten|Start workout|Empezar entreno|Inizia allenamento
Noch kein Training gespeichert.|No workout saved yet.|Aún no hay entrenos guardados.|Nessun allenamento salvato.
Letztes Training:|Last workout:|Último entreno:|Ultimo allenamento:
Trainingshistorie|Training history|Historial de entreno|Storico allenamenti
← Trainingsplan|← Training plan|← Plan de entreno|← Piano di allenamento
Satz|Set|Serie|Serie
Gewicht|Weight|Peso|Peso
Training speichern|Save workout|Guardar entreno|Salva allenamento
Training gespeichert|Workout saved|Entreno guardado|Allenamento salvato
Erstes Mal – trag dein Startgewicht ein.|First time – enter your starting weight.|Primera vez – introduce tu peso inicial.|Prima volta – inserisci il peso iniziale.
Die Werte vom letzten Mal sind schon eingetragen – passe an, was du heute geschafft hast.|Last time's values are already filled in – adjust to what you did today.|Los valores de la última vez ya están – ajusta lo que hiciste hoy.|I valori dell'ultima volta sono già inseriti – adatta a ciò che hai fatto oggi.
Trag pro Satz Gewicht und Wiederholungen ein. Beim nächsten Mal stehen diese Werte schon hier.|Enter weight and reps per set. Next time these values will already be here.|Introduce peso y repeticiones por serie. La próxima vez ya estarán aquí.|Inserisci peso e ripetizioni per serie. La prossima volta saranno già qui.
Schwerster Satz pro Training – so siehst du, wie sich deine Gewichte entwickeln.|Heaviest set per workout – see how your weights develop.|Serie más pesada por entreno – así ves cómo evolucionan tus pesos.|Serie più pesante per allenamento – così vedi come crescono i carichi.
Bestwert|Best|Mejor marca|Record
zuletzt|last|último|ultimo
Noch keine Trainings gespeichert. Starte im Trainingsplan ein Training – danach siehst du hier für jede Übung deinen Verlauf.|No workouts saved yet. Start one in your training plan – then you'll see each exercise's progress here.|Aún no hay entrenos. Empieza uno en tu plan – luego verás aquí la evolución de cada ejercicio.|Ancora nessun allenamento. Avviane uno dal piano – poi qui vedrai l'andamento di ogni esercizio.
Deine Erfolge|Your achievements|Tus logros|I tuoi traguardi
Erfolge|Achievements|Logros|Traguardi
Jede Medaille steht für etwas, das du durchgezogen hast. Ausgegraute zeigen, was als Nächstes kommt.|Every medal stands for something you pulled through. Greyed-out ones show what's next.|Cada medalla representa algo que lograste. Las grises muestran lo que viene.|Ogni medaglia è qualcosa che hai portato a termine. Quelle grigie mostrano cosa viene dopo.
von 30 Medaillen|of 30 medals|de 30 medallas|di 30 medaglie
Fast geschafft|Almost there|Casi lo tienes|Quasi fatto
Bronze|Bronze|Bronce|Bronzo
Silber|Silver|Plata|Argento
Gold|Gold|Oro|Oro
Alle Stufen 🎉|All tiers 🎉|Todos los niveles 🎉|Tutti i livelli 🎉
Neu freigeschaltet:|Newly unlocked:|Recién desbloqueado:|Appena sbloccato:
Dranbleiber|Stay-on-tracker|Constante|Costante
Kilometerfresser|Mile muncher|Devorakilómetros|Macinachilometri
Zielläufer|Goal walker|Caminante con meta|Camminatore da obiettivo
Schlafprofi|Sleep pro|Experto en sueño|Professionista del sonno
Waagen-Routine|Scale routine|Rutina de báscula|Routine della bilancia
Plantreue|Plan keeper|Fiel al plan|Fedele al piano
Eisenfreund|Iron friend|Amigo del hierro|Amico del ferro
Tonnenstemmer|Tonnage lifter|Levantatoneladas|Sollevatore di tonnellate
Rekordjäger|Record hunter|Cazarrécords|Cacciatore di record
Teamplayer|Team player|Jugador de equipo|Gioco di squadra
Was sich dein Klient mit seinen Medaillen gegönnt hat.|What your client treated themselves to with medals.|Lo que tu cliente se ha dado con sus medallas.|Cosa si è concesso il tuo cliente con le medaglie.
Dein Kühlschrank – gefüllt mit dem, was du dir mit Medaillen verdient hast.|Your fridge – filled with what you earned with medals.|Tu nevera – llena de lo que te has ganado con medallas.|Il tuo frigo – pieno di ciò che hai guadagnato con le medaglie.
Inhalt des Kühlschranks|Fridge contents|Contenido de la nevera|Contenuto del frigo
↻ Nochmal reingleiten|↻ Glide in again|↻ Entrar otra vez|↻ Entra di nuovo
Noch leer. Im|Still empty. In the|Aún vacía. En la|Ancora vuoto. Nel
tauschst du Medaillen gegen Dosen.|you trade medals for cans.|cambias medallas por latas.|scambi medaglie con lattine.
Noch leer – dein Klient hat sich noch nichts gegönnt.|Still empty – your client hasn't treated themselves yet.|Aún vacía – tu cliente todavía no se ha dado ningún capricho.|Ancora vuoto – il tuo cliente non si è ancora concesso nulla.
Tausche deine Medaillen gegen eine kalte Dose für deinen Kühlschrank.|Trade your medals for a cold can for your fridge.|Cambia tus medallas por una lata fría para tu nevera.|Scambia le medaglie con una lattina fresca per il tuo frigo.
Medaille verfügbar|medal available|medalla disponible|medaglia disponibile
Medaillen verfügbar|medals available|medallas disponibles|medaglie disponibili
Zum Kühlschrank →|To the fridge →|A la nevera →|Al frigo →
Kaufen|Buy|Comprar|Compra
Ab in den Kühlschrank|Into the fridge|A la nevera|Nel frigo
Das ist neu: StayOnTrack|What's new: StayOnTrack|Novedades: StayOnTrack|Novità: StayOnTrack
Verstanden|Got it|Entendido|Ho capito
Zum Trainingsplan|To the training plan|Al plan de entreno|Al piano di allenamento
Zum Shop|To the shop|A la tienda|Al negozio
Neuer Name: StayOnTrack|New name: StayOnTrack|Nuevo nombre: StayOnTrack|Nuovo nome: StayOnTrack
Mit neuem, schlichtem Logo.|With a new, minimal logo.|Con un logo nuevo y minimalista.|Con un nuovo logo minimalista.
Sprache & Erscheinungsbild|Language & theme|Idioma y tema|Lingua e tema
In den Einstellungen: Deutsch, Englisch, Spanisch oder Italienisch – und Hell, Dunkel oder wie das System.|In Settings: German, English, Spanish or Italian – and light, dark or like your system.|En Ajustes: alemán, inglés, español o italiano – y claro, oscuro o como el sistema.|Nelle impostazioni: tedesco, inglese, spagnolo o italiano – e chiaro, scuro o come il sistema.
Optional in den Einstellungen: gläserne Leisten und Menüs wie im aktuellen iOS.|Optional in Settings: glass bars and menus like the latest iOS.|Opcional en Ajustes: barras y menús de cristal como en el iOS actual.|Facoltativo nelle impostazioni: barre e menu in vetro come nell'iOS attuale.
Kühlschrank & Shop|Fridge & shop|Nevera y tienda|Frigo e negozio
Hall of Fame jetzt unter Konto. Tausche Medaillen im Shop gegen Dosen für deinen Kühlschrank.|Hall of Fame now lives under Account. Trade medals in the shop for cans for your fridge.|El Salón de la fama está ahora en Cuenta. Cambia medallas en la tienda por latas para tu nevera.|La Hall of Fame ora è in Account. Scambia medaglie nel negozio con lattine per il tuo frigo.
Unter Konto: Deutsch, Englisch, Spanisch oder Italienisch – und Hell, Dunkel oder wie das System.|Under Account: German, English, Spanish or Italian – and light, dark or like your system.|En Cuenta: alemán, inglés, español o italiano – y claro, oscuro o como el sistema.|In Account: tedesco, inglese, spagnolo o italiano – e chiaro, scuro o come il sistema.
Optional unter Konto: gläserne Leisten und Menüs wie im aktuellen iOS.|Optional under Account: glass bars and menus like the latest iOS.|Opcional en Cuenta: barras y menús de cristal como en el iOS actual.|Facoltativo in Account: barre e menu in vetro come nell'iOS attuale.
In der Hall of Fame deiner Klienten siehst du, was sie sich mit Medaillen gegönnt haben.|In your clients' Hall of Fame you see what they treated themselves to with medals.|En el Salón de la fama de tus clientes ves lo que se han dado con medallas.|Nella Hall of Fame dei tuoi clienti vedi cosa si sono concessi con le medaglie.
Apple Health|Apple Health|Apple Health|Apple Health
Apple Health ist vorerst deaktiviert.|Apple Health is switched off for now.|Apple Health está desactivado por ahora.|Apple Health è disattivato per ora.
Übersicht|Overview|Resumen|Panoramica
Meine Klienten|My clients|Mis clientes|I miei clienti
Zu erledigen|To do|Pendiente|Da fare
Alle Klienten|All clients|Todos los clientes|Tutti i clienti
← Alle Klienten|← All clients|← Todos los clientes|← Tutti i clienti
Alles erledigt.|All done.|Todo hecho.|Tutto fatto.
Gerade wartet nichts auf dich.|Nothing is waiting for you right now.|Ahora mismo no hay nada pendiente.|Al momento non c'è nulla in attesa.
Check-ins ab Samstag|Check-ins from Saturday|Check-ins desde el sábado|Check-in da sabato
Klient|Client|Cliente|Cliente
CSV exportieren|Export CSV|Exportar CSV|Esporta CSV
+ Neuer Klient|+ New client|+ Nuevo cliente|+ Nuovo cliente
Ungelesene Nachrichten|Unread messages|Mensajes sin leer|Messaggi non letti
Gewicht heute offen|Weight still open today|Peso pendiente hoy|Peso ancora da inserire oggi
Plananpassungen offen|Plan changes open|Cambios de plan pendientes|Modifiche al piano aperte
Ohne Eintrag seit 2+ Tagen|No entry for 2+ days|Sin registro desde hace 2+ días|Nessuna registrazione da 2+ giorni
Tauschwünsche|Swap requests|Solicitudes de cambio|Richieste di sostituzione
Push-Benachrichtigungen|Push notifications|Notificaciones push|Notifiche push
Ziele ändern|Change goals|Cambiar objetivos|Modifica obiettivi
Kategorie|Category|Categoría|Categoria
Plan & Ziele|Plan & goals|Plan y objetivos|Piano e obiettivi
Zielgewicht|Target weight|Peso objetivo|Peso obiettivo
Zielkalorien pro Tag|Daily calorie target|Calorías objetivo por día|Calorie obiettivo al giorno
nur für dich sichtbar|only visible to you|solo visible para ti|visibile solo a te
Alle Chats|All chats|Todos los chats|Tutte le chat
Chats|Chats|Chats|Chat
Zuletzt|Last|Último|Ultimo
zuletzt geändert von dir|last changed by you|último cambio tuyo|ultima modifica tua
zuletzt geändert von deinem Coach|last changed by your coach|último cambio de tu coach|ultima modifica del tuo coach
Tage eingetragen|days logged|días registrados|giorni registrati
30 T|30 d|30 d|30 g
90 T|90 d|90 d|90 g
1 J|1 y|1 a|1 a
Medaille|medal|medalla|medaglia
Auf dem iPhone funktionieren Push-Nachrichten nur, wenn StayOnTrack auf dem Home-Bildschirm liegt: In Safari unten auf das Teilen-Symbol tippen → „Zum Home-Bildschirm“ → danach StayOnTrack über das neue App-Symbol öffnen und hier aktivieren.|On iPhone, push notifications only work when StayOnTrack is on your home screen: in Safari tap the Share icon → “Add to Home Screen” → then open StayOnTrack from the new app icon and turn them on here.|En iPhone, las notificaciones solo funcionan si StayOnTrack está en la pantalla de inicio: en Safari toca Compartir → “Añadir a pantalla de inicio” → abre StayOnTrack desde el nuevo icono y actívalas aquí.|Su iPhone le notifiche funzionano solo se StayOnTrack è nella schermata Home: in Safari tocca Condividi → “Aggiungi alla schermata Home” → poi apri StayOnTrack dalla nuova icona e attivale qui.
Gewöhnlich|Common|Común|Comune
Selten|Rare|Rara|Rara
Episch|Epic|Épica|Epica
Legendär|Legendary|Legendaria|Leggendaria
Zielmuskeln|Target muscles|Músculos trabajados|Muscoli target
Tipp:|Tip:|Consejo:|Consiglio:
Start|Start|Inicio|Inizio
Ende|End|Final|Fine
Anleitung|How to|Cómo se hace|Come si fa
Ernährungsplan anfragen|Request a nutrition plan|Pedir un plan de nutrición|Richiedi un piano alimentare
Plan beim Coach anfragen|Ask your coach for a plan|Pedir el plan a tu coach|Chiedi il piano al tuo coach
Noch kein Ernährungsplan|No nutrition plan yet|Aún no hay plan de nutrición|Ancora nessun piano alimentare
Erzähl deinem Coach kurz, was du magst und was nicht – daraus stellt er dir deinen Plan zusammen.|Tell your coach briefly what you like and what you don't – they'll build your plan from it.|Cuéntale a tu coach qué te gusta y qué no – con eso preparará tu plan.|Racconta al tuo coach cosa ti piace e cosa no – così preparerà il tuo piano.
Ein paar Fragen, damit dein Coach den Plan auf dich zuschneiden kann. Dauert etwa eine Minute.|A few questions so your coach can tailor the plan to you. Takes about a minute.|Unas preguntas para que tu coach adapte el plan a ti. Lleva un minuto.|Qualche domanda per adattare il piano a te. Ci vuole un minuto.
Anfrage gesendet ✓|Request sent ✓|Solicitud enviada ✓|Richiesta inviata ✓
Anfrage gesendet|Request sent|Solicitud enviada|Richiesta inviata
Dein Coach meldet sich|Your coach will get back to you|Tu coach te responderá|Il tuo coach ti risponderà
Dein Coach stellt dir anhand deiner Antworten einen Plan zusammen. Du bekommst Bescheid, sobald er da ist.|Your coach is building a plan from your answers. You'll be notified when it's ready.|Tu coach prepara un plan con tus respuestas. Te avisaremos cuando esté listo.|Il tuo coach prepara un piano dalle tue risposte. Ti avviseremo quando è pronto.
Dein Coach arbeitet an deinem Plan.|Your coach is working on your plan.|Tu coach está trabajando en tu plan.|Il tuo coach sta lavorando al tuo piano.
Antworten ändern|Change answers|Cambiar respuestas|Modifica risposte
Antworten speichern|Save answers|Guardar respuestas|Salva risposte
Noch etwas?|Anything else?|¿Algo más?|Altro?
Anmerkung|Note|Nota|Nota
Wie ernährst du dich?|How do you eat?|¿Cómo te alimentas?|Come ti alimenti?
Ich esse alles|I eat everything|Como de todo|Mangio di tutto
Pescetarisch|Pescatarian|Pescetariano|Pescetariano
Vegetarisch|Vegetarian|Vegetariano|Vegetariano
Vegan|Vegan|Vegano|Vegano
Was geht nicht?|What's a no-go?|¿Qué no puede ser?|Cosa non va?
Allergien, Unverträglichkeiten oder einfach „mag ich nicht“|Allergies, intolerances or simply “don't like it”|Alergias, intolerancias o simplemente “no me gusta”|Allergie, intolleranze o semplicemente “non mi piace”
Laktose|Lactose|Lactosa|Lattosio
Gluten|Gluten|Gluten|Glutine
Nüsse|Nuts|Frutos secos|Frutta secca
Eier|Eggs|Huevos|Uova
Fisch & Meeresfrüchte|Fish & seafood|Pescado y marisco|Pesce e frutti di mare
Schweinefleisch|Pork|Cerdo|Maiale
Soja|Soy|Soja|Soia
Scharfes|Spicy food|Picante|Piccante
Welche Proteinquellen magst du am liebsten?|Which protein sources do you like best?|¿Qué fuentes de proteína prefieres?|Quali fonti proteiche preferisci?
Mehrere möglich|Pick several|Puedes elegir varias|Più risposte possibili
Rind|Beef|Ternera|Manzo
Hähnchen|Chicken|Pollo|Pollo
Pute|Turkey|Pavo|Tacchino
Schwein|Pork|Cerdo|Maiale
Fisch|Fish|Pescado|Pesce
Skyr, Quark & Co.|Skyr, quark & co.|Skyr, queso fresco y similares|Skyr, quark e simili
Hülsenfrüchte|Legumes|Legumbres|Legumi
Tofu & Tempeh|Tofu & tempeh|Tofu y tempeh|Tofu e tempeh
Proteinshake|Protein shake|Batido de proteína|Frullato proteico
Wie viele Mahlzeiten am Tag passen in deinen Alltag?|How many meals a day fit your routine?|¿Cuántas comidas al día encajan en tu rutina?|Quanti pasti al giorno si adattano alla tua routine?
5 oder mehr|5 or more|5 o más|5 o più
Soll auf das Budget geachtet werden?|Should we watch the budget?|¿Hay que cuidar el presupuesto?|Bisogna badare al budget?
Ja, möglichst günstig|Yes, as cheap as possible|Sí, lo más barato posible|Sì, il più economico possibile
Normal|Normal|Normal|Normale
Egal – Qualität zählt|Doesn't matter – quality counts|Da igual – cuenta la calidad|Non importa – conta la qualità
Wie viel Zeit hast du zum Kochen?|How much time do you have to cook?|¿Cuánto tiempo tienes para cocinar?|Quanto tempo hai per cucinare?
Schnell & einfach (max. 15 Min.)|Quick & easy (max. 15 min)|Rápido y fácil (máx. 15 min)|Veloce e semplice (max 15 min)
Normal (ca. 30 Min.)|Normal (about 30 min)|Normal (unos 30 min)|Normale (circa 30 min)
Ich koche gerne|I like cooking|Me gusta cocinar|Mi piace cucinare
Vorkochen (Meal Prep)?|Cook ahead (meal prep)?|¿Cocinar con antelación (meal prep)?|Cucinare in anticipo (meal prep)?
Ja, gerne|Yes, happy to|Sí, encantado|Sì, volentieri
Manchmal|Sometimes|A veces|A volte
Lieber nicht|Rather not|Mejor no|Meglio di no
Sonstiges, z. B. Pilze|Other, e.g. mushrooms|Otro, p. ej. setas|Altro, es. funghi
z. B. Mittags esse ich in der Kantine|e.g. I eat lunch at the canteen|p. ej. Al mediodía como en el comedor|es. A pranzo mangio in mensa
Dein Coach stellt dir einen Plan zusammen, der zu dir passt.|Your coach puts together a plan that suits you.|Tu coach te prepara un plan a tu medida.|Il tuo coach ti prepara un piano su misura.
Ernährungsplan angefragt|Nutrition plan requested|Plan de nutrición solicitado|Piano alimentare richiesto
Plan-Anfragen|Plan requests|Solicitudes de plan|Richieste di piano
Wünsche für den Ernährungsplan|Wishes for the nutrition plan|Preferencias para el plan|Preferenze per il piano
Als erledigt markieren|Mark as done|Marcar como hecho|Segna come fatto
Das ist neu|What's new|Novedades|Novità
Medaillen sind jetzt Token wert|Medals are now worth tokens|Las medallas ahora valen tokens|Le medaglie ora valgono token
Bronze 1, Silber 2, Gold 3 Token – im Shop tauschst du sie gegen Dosen.|Bronze 1, silver 2, gold 3 tokens – trade them for cans in the shop.|Bronce 1, plata 2, oro 3 tokens – cámbialos por latas en la tienda.|Bronzo 1, argento 2, oro 3 token – scambiali con lattine nel negozio.
Noch kein Plan? Unter „Ernährung“ beantwortest du ein paar Fragen und dein Coach erstellt deinen Plan.|No plan yet? Answer a few questions under “Nutrition” and your coach builds your plan.|¿Sin plan? Responde unas preguntas en “Nutrición” y tu coach crea tu plan.|Nessun piano? Rispondi a qualche domanda in “Alimentazione” e il coach crea il tuo piano.
Übungen erklärt|Exercises explained|Ejercicios explicados|Esercizi spiegati
Tippe im Trainingsplan auf „i“ neben einer Übung: Fotos, Ausführung und Tipp.|Tap “i” next to an exercise in your plan: photos, how-to and a tip.|Toca la “i” junto a un ejercicio: fotos, ejecución y consejo.|Tocca la “i” accanto a un esercizio: foto, esecuzione e consiglio.
Seltene Dosen|Rare cans|Latas raras|Lattine rare
Dosen haben jetzt Seltenheiten – die seltensten stehen im Kühlschrank ganz oben.|Cans now have rarities – the rarest sit at the top of your fridge.|Las latas tienen rareza – las más raras van arriba en la nevera.|Le lattine hanno una rarità – le più rare stanno in cima al frigo.
Hall of Fame jetzt unter Konto, mit Kühlschrank und Shop.|Hall of Fame now under Account, with fridge and shop.|Salón de la fama ahora en Cuenta, con nevera y tienda.|Hall of Fame ora in Account, con frigo e negozio.
Trainingsplan|Training plan|Plan de entreno|Piano di allenamento
Neuer Tab „Training“: Split wählen, Übungen anpassen und Gewichte tracken.|New “Training” tab: pick a split, adjust exercises and track weights.|Nueva pestaña “Entreno”: elige split, ajusta ejercicios y registra pesos.|Nuova scheda “Allenamento”: scegli lo split, modifica esercizi e registra i carichi.
Medaillen in Bronze, Silber und Gold für deine Erfolge.|Bronze, silver and gold medals for your achievements.|Medallas de bronce, plata y oro por tus logros.|Medaglie di bronzo, argento e oro per i tuoi traguardi.
Token verfügbar|tokens available|tokens disponibles|token disponibili
Kaufen|Buy|Comprar|Compra
Jede Medaille ist Token wert – Bronze 1, Silber 2, Gold 3. Tausch sie gegen eine kalte Dose für deinen Kühlschrank.|Every medal is worth tokens – bronze 1, silver 2, gold 3. Trade them for a cold can for your fridge.|Cada medalla vale tokens – bronce 1, plata 2, oro 3. Cámbialos por una lata fría.|Ogni medaglia vale token – bronzo 1, argento 2, oro 3. Scambiali con una lattina fresca.
Dein Kühlschrank – gefüllt mit dem, was du dir mit deinen Token gegönnt hast.|Your fridge – filled with what you treated yourself to with your tokens.|Tu nevera – llena de lo que te has dado con tus tokens.|Il tuo frigo – pieno di ciò che ti sei concesso con i token.
tauschst du Token gegen Dosen.|you trade tokens for cans.|cambias tokens por latas.|scambi token con lattine.
KI-Vorgaben für Ernährungspläne|AI rules for nutrition plans|Reglas de IA para planes de nutrición|Regole IA per i piani alimentari
Daran hält sich die KI bei jedem Entwurf – z. B. was zum Frühstück passt und was nicht. Eine Regel pro Zeile, in deinen eigenen Worten.|The AI follows these for every draft – e.g. what fits breakfast and what doesn't. One rule per line, in your own words.|La IA las sigue en cada borrador – p. ej. qué encaja en el desayuno. Una regla por línea.|L'IA le segue in ogni bozza – es. cosa va bene a colazione. Una regola per riga.
Vorgaben speichern|Save rules|Guardar reglas|Salva regole
Standard wiederherstellen|Restore default|Restaurar estándar|Ripristina predefinito
angepasst|customised|personalizado|personalizzato
Standard|Default|Estándar|Predefinito
Gilt nur für den nächsten Entwurf. Dauerhafte Regeln stellst du im|Applies to the next draft only. Set permanent rules in the|Solo para el próximo borrador. Las reglas fijas se configuran en|Vale solo per la prossima bozza. Le regole fisse si impostano in
KI-Vorgaben|AI rules|Reglas de IA|Regole IA
Im Admin-Tool legst du fest, was die KI in welche Mahlzeit packt – z. B. kein warmes Hauptgericht zum Frühstück. Beim Entwurf kannst du zusätzlich einen einmaligen Hinweis mitgeben.|In the admin tool you decide what the AI puts into which meal – e.g. no hot main course at breakfast. You can also add a one-off note per draft.|En el panel de administración decides qué pone la IA en cada comida – p. ej. nada de plato caliente en el desayuno. También puedes añadir una nota puntual por borrador.|Nello strumento admin decidi cosa mette l'IA in ogni pasto – es. niente piatto caldo a colazione. Puoi anche aggiungere una nota per singola bozza.
Mehr Sicherheit|More security|Más seguridad|Più sicurezza
Besserer Schutz gegen Passwort-Raten beim Login. Automatische KI-Entwürfe und Push-Nachrichten bei Plan-Anfragen sind begrenzt, damit niemand dein KI-Guthaben aufbrauchen kann.|Better protection against password guessing at login. Automatic AI drafts and push messages for plan requests are limited so nobody can use up your AI credit.|Mejor protección contra adivinar contraseñas al iniciar sesión. Los borradores automáticos de IA y los avisos por solicitudes de plan están limitados para que nadie agote tu saldo de IA.|Migliore protezione contro i tentativi di indovinare la password. Bozze IA automatiche e notifiche per richieste di piano sono limitate, così nessuno può esaurire il tuo credito IA.
Dein eigener Kühlschrank|Your own fridge|Tu propia nevera|Il tuo frigo personale
Auf der Tür deines Kühlschranks steht jetzt dein Name – in Pixel-Schrift.|Your fridge door now shows your name – in pixel letters.|La puerta de tu nevera ahora lleva tu nombre – en letras pixeladas.|Sulla porta del tuo frigo ora c'è il tuo nome – in lettere pixel.
Kühlschrank mit Namen|Fridge with name|Nevera con nombre|Frigo con nome
Mythisch|Mythic|Mítica|Mitica
Neu im Shop|New in the shop|Nuevo en la tienda|Novità nel negozio
Jede Medaille ist Token wert – Bronze 1, Silber 2, Gold 3. Tausch sie gegen etwas für deinen Kühlschrank.|Every medal is worth tokens – bronze 1, silver 2, gold 3. Trade them for something for your fridge.|Cada medalla vale tokens – bronce 1, plata 2, oro 3. Cámbialos por algo para tu nevera.|Ogni medaglia vale token – bronzo 1, argento 2, oro 3. Scambiali con qualcosa per il tuo frigo.
Ab in deinen Kühlschrank|Into your fridge|A tu nevera|Nel tuo frigo
Tippen zum Schließen|Tap to close|Toca para cerrar|Tocca per chiudere
Große Kaufanimation|Big purchase animation|Gran animación de compra|Grande animazione d'acquisto
Jeder Kauf im Shop wird gefeiert – je seltener das Getränk, desto spektakulärer.|Every purchase in the shop is celebrated – the rarer the drink, the more spectacular.|Cada compra en la tienda se celebra – cuanto más raro, más espectacular.|Ogni acquisto nel negozio viene festeggiato – più è raro, più è spettacolare.
Faire Token|Fair tokens|Tokens justos|Token equi
Fällt eine Medaille durch eine Korrektur weg, verschwindet auch das, was du mit ihren Token gekauft hast.|If a correction removes a medal, whatever you bought with its tokens goes too.|Si una corrección elimina una medalla, también desaparece lo que compraste con sus tokens.|Se una correzione toglie una medaglia, sparisce anche ciò che hai comprato con i suoi token.
Test-Kühlschrank|Test fridge|Nevera de prueba|Frigo di prova
Nur für dich als Coach|Only for you as a coach|Solo para ti como coach|Solo per te come coach
Alles gratis – zum Ausprobieren von Kühlschrank, Seltenheiten und Kaufanimationen. Deine Klienten sehen davon nichts.|Everything free – to try out the fridge, rarities and purchase animations. Your clients see none of this.|Todo gratis – para probar la nevera, las rarezas y las animaciones de compra. Tus clientes no ven nada de esto.|Tutto gratis – per provare frigo, rarità e animazioni d'acquisto. I tuoi clienti non vedono nulla.
Testmodus – alles gratis|Test mode – everything free|Modo de prueba – todo gratis|Modalità prova – tutto gratis
Kühlschrank leeren|Empty fridge|Vaciar nevera|Svuota frigo
Gratis holen|Get for free|Coger gratis|Prendi gratis
Gratis|Free|Gratis|Gratis
Dein Test-Kühlschrank|Your test fridge|Tu nevera de prueba|Il tuo frigo di prova
Unter Konto → Test-Kühlschrank: Kühlschrank und Shop nur für dich, alles gratis. Probier Seltenheiten und Kaufanimationen aus und leere ihn jederzeit wieder.|Under Account → Test fridge: fridge and shop just for you, everything free. Try rarities and purchase animations and empty it any time.|En Cuenta → Nevera de prueba: nevera y tienda solo para ti, todo gratis. Prueba rarezas y animaciones y vacíala cuando quieras.|In Account → Frigo di prova: frigo e negozio solo per te, tutto gratis. Prova rarità e animazioni e svuotalo quando vuoi.
Sold out|Sold out|Agotado|Esaurito
Jedes Getränk gibt es einmal: Nach dem Kauf ist es im Shop ausverkauft.|Every drink exists once: after buying it, it is sold out in the shop.|Cada bebida existe una vez: tras comprarla, se agota en la tienda.|Ogni bevanda esiste una volta: dopo l'acquisto è esaurita nel negozio.
Sanftere Übergänge|Smoother transitions|Transiciones más suaves|Transizioni più fluide
Seiten, Fenster und Fortschrittsanzeigen gleiten jetzt ruhig ins Bild.|Pages, windows and progress indicators now glide in calmly.|Páginas, ventanas e indicadores de progreso aparecen ahora con suavidad.|Pagine, finestre e indicatori di avanzamento ora entrano con calma.
Sold out im Shop|Sold out in the shop|Agotado en la tienda|Esaurito nel negozio
Jedes Getränk kann ein Klient nur einmal kaufen – im Test-Kühlschrank kannst du es durch Leeren zurückholen.|Clients can buy each drink only once – in your test fridge, emptying it brings drinks back.|Cada cliente puede comprar cada bebida una sola vez – en tu nevera de prueba, al vaciarla vuelven.|Ogni cliente può comprare ogni bevanda una sola volta – nel frigo di prova svuotandolo tornano disponibili.
Tagebuch|Diary|Diario|Diario
Plan|Plan|Plan|Piano
Was du isst|What you eat|Lo que comes|Cosa mangi
Ernährungstagebuch|Food diary|Diario de comidas|Diario alimentare
Frühstück|Breakfast|Desayuno|Colazione
Mittagessen|Lunch|Almuerzo|Pranzo
Abendessen|Dinner|Cena|Cena
Snacks|Snacks|Snacks|Spuntini
+ Lebensmittel|+ Food|+ Alimento|+ Alimento
Scannen|Scan|Escanear|Scansiona
Gestern|Yesterday|Ayer|Ieri
Vorheriger Tag|Previous day|Día anterior|Giorno precedente
Nächster Tag|Next day|Día siguiente|Giorno successivo
Noch nichts eingetragen.|Nothing logged yet.|Aún no hay nada.|Ancora niente.
Nichts eingetragen.|Nothing logged.|Nada registrado.|Niente registrato.
Noch kein Kalorienziel|No calorie target yet|Aún sin objetivo de calorías|Ancora nessun obiettivo calorico
Eiweiß|Protein|Proteína|Proteine
Kohlenhydrate|Carbs|Carbohidratos|Carboidrati
Kohlenh.|Carbs|Carbohidr.|Carboidr.
Fett|Fat|Grasa|Grassi
Makroziele pro Tag|Daily macro targets|Objetivos de macros diarios|Obiettivi macro giornalieri
Makroziele speichern|Save macro targets|Guardar objetivos de macros|Salva obiettivi macro
Makroziele gespeichert|Macro targets saved|Objetivos de macros guardados|Obiettivi macro salvati
E · K · F (g)|P · C · F (g)|P · C · G (g)|P · C · G (g)
Lebensmittel suchen…|Search foods…|Buscar alimentos…|Cerca alimenti…
Zuletzt gegessen|Recently eaten|Comido recientemente|Mangiato di recente
Nicht dabei? Selbst eintragen|Not listed? Enter it yourself|¿No está? Introdúcelo tú|Non c'è? Inseriscilo tu
Selbst eintragen|Enter manually|Introducir a mano|Inserisci a mano
Menge|Amount|Cantidad|Quantità
Mahlzeit|Meal|Comida|Pasto
Marke|Brand|Marca|Marca
Weiter|Continue|Continuar|Continua
Eingetragen|Logged|Registrado|Registrato
Barcode scannen|Scan barcode|Escanear código de barras|Scansiona codice a barre
Scanner schließen|Close scanner|Cerrar escáner|Chiudi scanner
Kamera wird gestartet…|Starting camera…|Iniciando cámara…|Avvio fotocamera…
Barcode in den Rahmen halten|Hold the barcode inside the frame|Coloca el código dentro del marco|Tieni il codice nel riquadro
oder Nummer unter dem Barcode eintippen|or type the number below the barcode|o escribe el número bajo el código|o digita il numero sotto il codice
Barcode-Nummer|Barcode number|Número del código|Numero del codice
Ein Barcode hat 8 bis 14 Ziffern.|A barcode has 8 to 14 digits.|Un código tiene de 8 a 14 dígitos.|Un codice ha da 8 a 14 cifre.
Keine Kamera verfügbar – tipp die Nummer unter dem Barcode ein.|No camera available – type the number below the barcode.|No hay cámara – escribe el número bajo el código.|Nessuna fotocamera – digita il numero sotto il codice.
Kein Kamerazugriff. Erlaube die Kamera in den Browser-Einstellungen oder tipp die Nummer ein.|No camera access. Allow the camera in your browser settings or type the number.|Sin acceso a la cámara. Permítela en el navegador o escribe el número.|Nessun accesso alla fotocamera. Consentila nel browser o digita il numero.
Scanner konnte nicht geladen werden – tipp die Nummer ein.|The scanner could not be loaded – type the number.|No se pudo cargar el escáner – escribe el número.|Impossibile caricare lo scanner – digita il numero.
Produkt nicht gefunden – trag die Werte von der Packung ein.|Product not found – enter the values from the package.|Producto no encontrado – introduce los valores del envase.|Prodotto non trovato – inserisci i valori della confezione.
Die Kalorien des Tages landen automatisch im Tracker. Produktdaten beim Scannen: Open Food Facts.|The day's calories go into the tracker automatically. Product data when scanning: Open Food Facts.|Las calorías del día pasan solas al tracker. Datos de productos al escanear: Open Food Facts.|Le calorie del giorno finiscono da sole nel tracker. Dati prodotto alla scansione: Open Food Facts.
Die Werte pro 100 g stehen auf der Packung (Nährwerttabelle).|The values per 100 g are on the package (nutrition table).|Los valores por 100 g están en el envase (tabla nutricional).|I valori per 100 g sono sulla confezione (tabella nutrizionale).
Nicht für alle Lebensmittel sind Makros hinterlegt.|Not all foods have macros.|No todos los alimentos tienen macros.|Non tutti gli alimenti hanno i macro.
Bitte eine Menge angeben.|Please enter an amount.|Introduce una cantidad.|Inserisci una quantità.
Tipp los, z. B. „Skyr“ – oder scann einen Barcode.|Start typing, e.g. "skyr" – or scan a barcode.|Empieza a escribir, p. ej. «skyr» – o escanea un código.|Inizia a scrivere, ad es. «skyr» – o scansiona un codice.
Nichts gefunden. Scann die Packung oder trag es selbst ein.|Nothing found. Scan the package or enter it yourself.|Nada encontrado. Escanea el envase o introdúcelo tú.|Niente trovato. Scansiona la confezione o inseriscilo tu.
Markenprodukte|Branded products|Productos de marca|Prodotti di marca
Lebensmittel|Foods|Alimentos|Alimenti
Lebensmittel oder Marke suchen…|Search foods or brands…|Buscar alimentos o marcas…|Cerca alimenti o marchi…
Lebensmittel oder Marke suchen|Search foods or brands|Buscar alimentos o marcas|Cerca alimenti o marchi
Tipp los, z. B. „Skyr“ oder „Barebells“ – oder scann einen Barcode.|Start typing, e.g. "skyr" or "Barebells" – or scan a barcode.|Empieza a escribir, p. ej. «skyr» o «Barebells» – o escanea un código.|Inizia a scrivere, ad es. «skyr» o «Barebells» – o scansiona un codice.
Die Produktdatenbank ist gerade nicht erreichbar – trag die Werte von der Packung ein.|The product database can't be reached right now – enter the values from the package.|La base de datos de productos no está disponible – introduce los valores del envase.|Il database prodotti non è raggiungibile – inserisci i valori della confezione.
Fitness & Sporternährung|Fitness & sports nutrition|Fitness y nutrición deportiva|Fitness e nutrizione sportiva
Benutzername oder E-Mail|Username or email|Usuario o correo|Nome utente o e-mail
Passwort vergessen?|Forgot password?|¿Olvidaste la contraseña?|Password dimenticata?
E-Mail oder Benutzername|Email or username|Correo o usuario|E-mail o nome utente
Link senden|Send link|Enviar enlace|Invia link
Schau in dein Postfach|Check your inbox|Revisa tu bandeja de entrada|Controlla la tua casella
Neues Passwort festlegen|Set a new password|Establecer nueva contraseña|Imposta una nuova password
Wiederholen|Repeat|Repetir|Ripeti
Passwort speichern|Save password|Guardar contraseña|Salva password
Zur Anmeldung|Back to login|Ir al inicio de sesión|Vai all'accesso
Zur App|Go to the app|Ir a la app|Vai all'app
E-Mail-Adresse bestätigt|Email address confirmed|Correo confirmado|Indirizzo e-mail confermato
Das hat nicht geklappt|That didn't work|No ha funcionado|Non ha funzionato
E-Mail-Adresse|Email address|Correo electrónico|Indirizzo e-mail
bestätigt|confirmed|confirmado|confermato
nicht bestätigt|not confirmed|no confirmado|non confermato
Noch keine hinterlegt.|None added yet.|Aún no hay ninguno.|Ancora nessuno.
E-Mail hinzufügen|Add email|Añadir correo|Aggiungi e-mail
Ändern|Change|Cambiar|Modifica
Bestätigung erneut senden|Resend confirmation|Reenviar confirmación|Invia di nuovo la conferma
E-Mail-Adresse ändern|Change email address|Cambiar correo|Modifica indirizzo e-mail
E-Mail-Adresse hinzufügen|Add email address|Añadir correo|Aggiungi indirizzo e-mail
Dein Passwort|Your password|Tu contraseña|La tua password
E-Mail-Adresse entfernt|Email address removed|Correo eliminado|Indirizzo e-mail rimosso
E-Mail ändern|Change email|Cambiar correo|Modifica e-mail
E-Mail hinterlegen|Add email|Añadir correo|Aggiungi e-mail
Head2Head|Head2Head|Head2Head|Head2Head
Head2Head einschalten|Turn on Head2Head|Activar Head2Head|Attiva Head2Head
Head2Head ausschalten|Turn off Head2Head|Desactivar Head2Head|Disattiva Head2Head
Head2Head ausgeschaltet|Head2Head turned off|Head2Head desactivado|Head2Head disattivato
Herausfordern|Challenge|Desafiar|Sfida
⚔️ Herausfordern|⚔️ Challenge|⚔️ Desafiar|⚔️ Sfida
Herausforderung senden|Send challenge|Enviar desafío|Invia sfida
Herausforderung gesendet|Challenge sent|Desafío enviado|Sfida inviata
Gegner|Opponent|Rival|Avversario
Disziplin|Discipline|Disciplina|Disciplina
Dauer|Duration|Duración|Durata
1 Woche|1 week|1 semana|1 settimana
2 Wochen|2 weeks|2 semanas|2 settimane
4 Wochen|4 weeks|4 semanas|4 settimane
Für dich|For you|Para ti|Per te
Laufend|Running|En curso|In corso
Beendet|Finished|Terminados|Concluse
Wer macht mit|Who's playing|Quién participa|Chi partecipa
Annehmen|Accept|Aceptar|Accetta
Ablehnen|Decline|Rechazar|Rifiuta
Angenommen|Accepted|Aceptado|Accettata
Abgelehnt|Declined|Rechazado|Rifiutata
Zurückgezogen|Withdrawn|Retirado|Ritirata
Verlauf ansehen|View progress|Ver evolución|Vedi andamento
← Alle Duelle|← All duels|← Todos los duelos|← Tutti i duelli
Alle Duelle →|All duels →|Todos los duelos →|Tutti i duelli →
Du|You|Tú|Tu
Du führst|You're ahead|Vas ganando|Sei in vantaggio
Gleichstand|Tied|Empate|Parità
🏆 Gewonnen|🏆 Won|🏆 Ganado|🏆 Vinto
Verloren|Lost|Perdido|Perso
Unentschieden|Draw|Empate|Pareggio
Siege|wins|victorias|vittorie
Niederlagen|losses|derrotas|sconfitte
Offen|Open|Abierto|Aperta
Trainingstage|Training days|Días de entrenamiento|Giorni di allenamento
Bewegtes Gewicht|Weight moved|Peso movido|Peso sollevato
Dranbleiben|Consistency|Constancia|Costanza
Gewicht verlieren|Lose weight|Perder peso|Perdere peso
Schlafziel|Sleep goal|Objetivo de sueño|Obiettivo sonno
Kalorienziel|Calorie target|Objetivo de calorías|Obiettivo calorico
Wer geht mehr Schritte?|Who walks more steps?|¿Quién camina más pasos?|Chi fa più passi?
Wer trainiert an mehr Tagen?|Who trains on more days?|¿Quién entrena más días?|Chi si allena più giorni?
Gewicht × Wiederholungen aus dem Trainingsplan|Weight × reps from the training plan|Peso × repeticiones del plan|Peso × ripetizioni dal piano
Wer trägt an mehr Tagen etwas ein?|Who logs something on more days?|¿Quién registra más días?|Chi registra più giorni?
Prozent vom Startgewicht – Kilos sieht niemand|Percent of starting weight – nobody sees kilos|Porcentaje del peso inicial – nadie ve los kilos|Percentuale del peso iniziale – nessuno vede i chili
Nächte, in denen du dein Schlafziel erreichst|Nights you reach your sleep goal|Noches en que alcanzas tu objetivo de sueño|Notti in cui raggiungi l'obiettivo di sonno
Tage, an denen du im Kalorienziel bleibst|Days you stay within your calorie target|Días dentro de tu objetivo de calorías|Giorni entro l'obiettivo calorico
Kampfansage|Trash talk|Provocación|Provocazione
Startet, sobald die Herausforderung angenommen wird. Unbeantwortet verfällt sie nach 7 Tagen.|Starts as soon as the challenge is accepted. Unanswered, it expires after 7 days.|Empieza en cuanto se acepta. Sin respuesta caduca a los 7 días.|Inizia appena viene accettata. Senza risposta scade dopo 7 giorni.
Nicht beantwortet – abgelaufen|Not answered – expired|Sin respuesta – caducado|Senza risposta – scaduta
Sehen dein Coach und – weil Head2Head an ist – andere Head2Head-Spieler.|Seen by your coach and – since Head2Head is on – other Head2Head players.|Lo ven tu coach y – al tener Head2Head activo – otros jugadores.|Lo vedono il coach e – con Head2Head attivo – gli altri giocatori.
Code senden|Send code|Enviar código|Invia codice
Code eingeben|Enter code|Introducir código|Inserisci codice
Code aus der E-Mail|Code from the email|Código del correo|Codice dall'e-mail
Neues Passwort wiederholen|Repeat new password|Repetir nueva contraseña|Ripeti nuova password
Keinen Code bekommen? Neuen senden|No code? Send a new one|¿No llegó? Enviar otro|Nessun codice? Invia di nuovo
Neuer Code ist unterwegs.|A new code is on its way.|Un nuevo código está en camino.|Un nuovo codice è in arrivo.
Der Code hat 6 Ziffern.|The code has 6 digits.|El código tiene 6 dígitos.|Il codice ha 6 cifre.
Du bist angemeldet|You're logged in|Has iniciado sesión|Hai effettuato l'accesso
+1 Token|+1 token|+1 token|+1 token
Gib deine E-Mail-Adresse oder deinen Benutzernamen ein. Du bekommst einen 6-stelligen Code an deine bestätigte E-Mail-Adresse.|Enter your email or username. You'll get a 6-digit code at your confirmed email address.|Introduce tu correo o usuario. Recibirás un código de 6 dígitos en tu correo confirmado.|Inserisci e-mail o nome utente. Riceverai un codice di 6 cifre all'indirizzo confermato.
Vorbei – bis morgen könnt ihr den letzten Tag noch nachtragen, dann steht der Endstand fest.|Over – you can still log the last day until tomorrow, then the final score is set.|Terminado – podéis registrar el último día hasta mañana; luego el resultado es definitivo.|Finito – potete registrare l'ultimo giorno fino a domani, poi il risultato è definitivo.
E-Mail-Versand|Email sending|Envío de correo|Invio e-mail
Test-Mail senden|Send test email|Enviar correo de prueba|Invia e-mail di prova
Dienst|Service|Servicio|Servizio
Absender|Sender|Remitente|Mittente
Links auf|Links to|Enlaces a|Link a
prüfen|check|revisar|controllare
aktiv|active|activo|attivo
Wird gesendet…|Sending…|Enviando…|Invio…
Berichte per E-Mail|Reports by email|Informes por correo|Report via e-mail
Als PDF|As PDF|En PDF|Come PDF
Plan als PDF|Plan as PDF|Plan en PDF|Piano in PDF
PDF herunterladen|Download PDF|Descargar PDF|Scarica PDF
Plan gesendet|Plan sent|Plan enviado|Piano inviato
Wochen-Check-in und Ernährungsplan als PDF an deine bestätigte E-Mail-Adresse.|Weekly check-in and nutrition plan as PDF to your confirmed email address.|Check-in semanal y plan de nutrición en PDF a tu correo confirmado.|Check-in settimanale e piano alimentare in PDF al tuo indirizzo confermato.
Google Health|Google Health|Google Health|Google Health
Verbunden|Connected|Conectado|Collegato
Nicht verbunden|Not connected|No conectado|Non collegato
Zugriff entzogen|Access revoked|Acceso revocado|Accesso revocato
Mit Google Health verbinden|Connect Google Health|Conectar Google Health|Collega Google Health
Neu verbinden|Reconnect|Volver a conectar|Ricollega
Jetzt abgleichen|Sync now|Sincronizar ahora|Sincronizza ora
Gleiche ab…|Syncing…|Sincronizando…|Sincronizzazione…
Trennen|Disconnect|Desconectar|Scollega
Was wird übertragen?|What is shared?|¿Qué se transfiere?|Cosa viene condiviso?
Freigabe erweitern|Extend access|Ampliar acceso|Estendi l'accesso
(nicht freigegeben)|(not shared)|(no compartido)|(non condiviso)
Google Health verbunden|Google Health connected|Google Health conectado|Google Health collegato
Google Health getrennt|Google Health disconnected|Google Health desconectado|Google Health scollegato
Abgeglichen|Synced|Sincronizado|Sincronizzato
Teilweise verbunden|Partly connected|Conectado en parte|Collegato in parte
Schritte und Schlaf kommen jetzt automatisch|Steps and sleep now arrive automatically|Pasos y sueño llegan ahora automáticamente|Passi e sonno arrivano ora automaticamente
Nicht alle Daten sind freigegeben|Not all data is shared|No se comparten todos los datos|Non tutti i dati sono condivisi
Schritte und Schlaf kommen automatisch in deinen Tracker – von deinem Fitbit, deiner Pixel Watch oder aus Apps, die mit Google Health bzw. Health Connect verbunden sind.|Steps and sleep arrive in your tracker automatically – from your Fitbit, Pixel Watch or apps connected to Google Health or Health Connect.|Pasos y sueño llegan solos a tu tracker – desde tu Fitbit, Pixel Watch o apps conectadas a Google Health o Health Connect.|Passi e sonno arrivano da soli nel tracker – da Fitbit, Pixel Watch o app collegate a Google Health o Health Connect.
Ungewöhnlich|Uncommon|Poco común|Non comune
Kosmisch|Cosmic|Cósmico|Cosmico
Deine Vitrine|Your showcase|Tu vitrina|La tua vetrina
Vitrine|Showcase|Vitrina|Vetrina
Vitrine ändern|Edit showcase|Cambiar vitrina|Modifica vetrina
Medaillen auswählen|Choose medals|Elegir medallas|Scegli medaglie
☆ In die Vitrine|☆ Add to showcase|☆ A la vitrina|☆ In vetrina
★ In der Vitrine|★ In showcase|★ En la vitrina|★ In vetrina
Tipp unten eine erreichte Medaille an|Tap an earned medal below|Toca abajo una medalla conseguida|Tocca sotto una medaglia ottenuta
Leer|Empty|Vacío|Vuoto
Noch leer. Wähle in der Hall of Fame bis zu drei erreichte Medaillen – deine Head2Head-Gegner sehen sie.|Still empty. Pick up to three earned medals in the Hall of Fame – your Head2Head opponents see them.|Aún vacía. Elige hasta tres medallas en el Salón de la Fama – tus rivales de Head2Head las verán.|Ancora vuota. Scegli fino a tre medaglie nella Hall of Fame – i tuoi avversari Head2Head le vedranno.
Diese Medaillen zeigt der Klient in seinem Profil.|The client shows these medals on their profile.|El cliente muestra estas medallas en su perfil.|Il cliente mostra queste medaglie nel profilo.
Datensicherung|Backups|Copias de seguridad|Backup
Jetzt sichern|Back up now|Copiar ahora|Esegui backup
Sichere…|Backing up…|Copiando…|Backup in corso…
Neueste herunterladen|Download latest|Descargar la última|Scarica l'ultimo
Gesichert|Backed up|Copiado|Salvato
Letzte|Last|Última|Ultimo
Automatisch|Automatic|Automático|Automatico
Verschlüsselt|Encrypted|Cifrado|Cifrato
heute|today|hoy|oggi
gestern|yesterday|ayer|ieri
noch nie|never|nunca|mai
`;

  const DICT = new Map();
  for (const line of RAW.split('\n')) {
    const parts = line.split('|');
    if (parts.length !== 4) continue;
    DICT.set(parts[0].trim(), { en: parts[1].trim(), es: parts[2].trim(), it: parts[3].trim() });
  }

  // Units inside dynamic texts (lower case, differ from the stand-alone labels above)
  const UNITS = {
    Schritte: { en: 'steps', es: 'pasos', it: 'passi' },
    Tage: { en: 'days', es: 'días', it: 'giorni' },
    Nächte: { en: 'nights', es: 'noches', it: 'notti' },
    Trainings: { en: 'workouts', es: 'entrenos', it: 'allenamenti' },
    'kg bewegt': { en: 'kg moved', es: 'kg movidos', it: 'kg sollevati' },
    Bestleistungen: { en: 'personal bests', es: 'marcas personales', it: 'record personali' },
    'Check-ins': { en: 'check-ins', es: 'check-ins', it: 'check-in' },
    'Tage in Folge': { en: 'days in a row', es: 'días seguidos', it: 'giorni di fila' },
  };
  const W = (de, en, es, it) => ({ de, en, es, it });
  const word = (lang, key) => (lang === 'de' ? key : (UNITS[key] || DICT.get(key) || {})[lang] || key);
  // (translate() is hoisted below and also handles patterns for longer parts)
  // Dynamic texts: [pattern, { en, es, it } as functions of the match]
  const PATTERNS = [
    [/^(\d+) von (\d+) eingetragen$/, W(0, (m) => `${m[1]} of ${m[2]} logged`, (m) => `${m[1]} de ${m[2]} registrados`, (m) => `${m[1]} di ${m[2]} registrati`)],
    [/^vor (\d+) Tagen$/, W(0, (m) => `${m[1]} days ago`, (m) => `hace ${m[1]} días`, (m) => `${m[1]} giorni fa`)],
    [/^(\d+) Tage in Folge eingetragen$/, W(0, (m) => `${m[1]} days logged in a row`, (m) => `${m[1]} días seguidos registrados`, (m) => `${m[1]} giorni di fila registrati`)],
    [/^Tag (\d+)$/, W(0, (m) => `Day ${m[1]}`, (m) => `Día ${m[1]}`, (m) => `Giorno ${m[1]}`)],
    [/^(\d+) Übungen$/, W(0, (m) => `${m[1]} exercises`, (m) => `${m[1]} ejercicios`, (m) => `${m[1]} esercizi`)],
    [/^Anleitung: (.+)$/, W(0, (m) => `How to: ${m[1]}`, (m) => `Cómo se hace: ${m[1]}`, (m) => `Come si fa: ${m[1]}`)],
    [/^Bitte beantworten: (.+)$/, W(0, (m, l) => `Please answer: ${translate(m[1])}`, (m) => `Responde, por favor: ${translate(m[1])}`, (m) => `Rispondi, per favore: ${translate(m[1])}`)],
    [/^Ziel ([^·]+)$/, W(0, (m) => `Target ${m[1]}`, (m) => `Objetivo ${m[1]}`, (m) => `Obiettivo ${m[1]}`)],
    [/^Ideal: (.+) Tage$/, W(0, (m) => `Ideal: ${m[1].replace('oder', 'or')} days`, (m) => `Ideal: ${m[1].replace('oder', 'o')} días`, (m) => `Ideale: ${m[1].replace('oder', 'o')} giorni`)],
    [/^Ein Split mit „Passt“ ist für (\d+) Trainingstage gedacht\. (.*)$/, W(0, (m) => `A split marked “Fits” is made for ${m[1]} training days. You get a standard plan with exercises, sets and reps.`, (m) => `Un split con “Encaja” está pensado para ${m[1]} días. Recibes un plan estándar con ejercicios, series y repeticiones.`, (m) => `Uno split con “Adatto” è pensato per ${m[1]} giorni. Ricevi un piano standard con esercizi, serie e ripetizioni.`)],
    [/^(.+?) Insgesamt ([\d.]+) Schritte gehen$/, null],
    [/^([\d.,]+(?: t)?) von ([\d.,]+(?: t)?) (.+)$/, W(0, (m, l) => `${m[1]} of ${m[2]} ${word(l, m[3])}`, (m, l) => `${m[1]} de ${m[2]} ${word(l, m[3])}`, (m, l) => `${m[1]} di ${m[2]} ${word(l, m[3])}`)],
    [/^✓ Erreicht am (.+)$/, W(0, (m) => `✓ Reached on ${m[1]}`, (m) => `✓ Logrado el ${m[1]}`, (m) => `✓ Raggiunto il ${m[1]}`)],
    [/^(\d+) Tage in Folge etwas eintragen$/, W(0, (m) => `Log something ${m[1]} days in a row`, (m) => `Registra algo ${m[1]} días seguidos`, (m) => `Registra qualcosa ${m[1]} giorni di fila`)],
    [/^Insgesamt ([\d.]+) Schritte gehen$/, W(0, (m) => `Walk ${m[1]} steps in total`, (m) => `Camina ${m[1]} pasos en total`, (m) => `Cammina ${m[1]} passi in totale`)],
    [/^An (\d+) Tagen dein Schrittziel \((.+)\) schaffen$/, W(0, (m) => `Hit your step goal (${m[2]}) on ${m[1]} days`, (m) => `Cumple tu objetivo de pasos (${m[2]}) ${m[1]} días`, (m) => `Raggiungi l'obiettivo passi (${m[2]}) per ${m[1]} giorni`)],
    [/^In (\d+) Nächten dein Schlafziel \((.+)\) erreichen$/, W(0, (m) => `Reach your sleep goal (${m[2]}) on ${m[1]} nights`, (m) => `Alcanza tu objetivo de sueño (${m[2]}) ${m[1]} noches`, (m) => `Raggiungi l'obiettivo di sonno (${m[2]}) per ${m[1]} notti`)],
    [/^An (\d+) Tagen dein Gewicht eintragen$/, W(0, (m) => `Log your weight on ${m[1]} days`, (m) => `Registra tu peso ${m[1]} días`, (m) => `Registra il peso per ${m[1]} giorni`)],
    [/^An (\d+) Tagen deine Kalorien einhalten$/, W(0, (m) => `Stay on your calories on ${m[1]} days`, (m) => `Cumple tus calorías ${m[1]} días`, (m) => `Rispetta le calorie per ${m[1]} giorni`)],
    [/^(\d+) Trainings absolvieren$/, W(0, (m) => `Complete ${m[1]} workouts`, (m) => `Completa ${m[1]} entrenos`, (m) => `Completa ${m[1]} allenamenti`)],
    [/^Insgesamt ([\d.,]+) Tonnen bewegen \(Gewicht × Wiederholungen\)$/, W(0, (m) => `Move ${m[1]} tonnes in total (weight × reps)`, (m) => `Mueve ${m[1]} toneladas en total (peso × reps)`, (m) => `Solleva ${m[1]} tonnellate in totale (peso × rip.)`)],
    [/^(\d+)× eine neue Bestleistung bei einer Übung aufstellen$/, W(0, (m) => `Set a new personal best ${m[1]} times`, (m) => `Logra una nueva marca personal ${m[1]} veces`, (m) => `Stabilisci un nuovo record ${m[1]} volte`)],
    [/^(\d+) Check-ins deines Coaches annehmen$/, W(0, (m) => `Accept ${m[1]} check-ins from your coach`, (m) => `Acepta ${m[1]} check-ins de tu coach`, (m) => `Accetta ${m[1]} check-in del coach`)],
    [/^Gerade (\d+) Tage? in Folge$/, W(0, (m) => `${m[1]} in a row right now`, (m) => `${m[1]} seguidos ahora mismo`, (m) => `${m[1]} di fila ora`)],
    [/^([\d.,]+(?: t)?) (Tage in Folge|Schritte|Tage|Nächte|Trainings|kg bewegt|Bestleistungen|Check-ins)( \(Rekord\))?$/, W(0, (m, l) => `${m[1]} ${word(l, m[2])}${m[3] ? ({ en: ' (record)', es: ' (récord)', it: ' (record)' })[l] : ''}`, (m, l) => `${m[1]} ${word(l, m[2])}${m[3] ? ' (récord)' : ''}`, (m, l) => `${m[1]} ${word(l, m[2])}${m[3] ? ' (record)' : ''}`)],
    [/^Aus deinem Kühlschrank genommen: (.+) – die Medaille dafür ist durch die Korrektur weggefallen\.$/, W(0, (m) => `Taken out of your fridge: ${m[1]} – the medal for it was lost through the correction.`, (m) => `Retirado de tu nevera: ${m[1]} – la medalla se perdió con la corrección.`, (m) => `Tolto dal tuo frigo: ${m[1]} – la medaglia è venuta meno con la correzione.`)],
    [/^(\d+) Getränke? · Testmodus: alles gratis$/, W(0, (m) => `${m[1]} drink${m[1] === '1' ? '' : 's'} · test mode: everything free`, (m) => `${m[1]} bebida${m[1] === '1' ? '' : 's'} · modo de prueba: todo gratis`, (m) => `${m[1]} bevand${m[1] === '1' ? 'a' : 'e'} · modalità prova: tutto gratis`)],
    [/^(\d+) Getränke? im Test-Kühlschrank$/, W(0, (m) => `${m[1]} drink${m[1] === '1' ? '' : 's'} in the test fridge`, (m) => `${m[1]} bebida${m[1] === '1' ? '' : 's'} en la nevera de prueba`, (m) => `${m[1]} bevand${m[1] === '1' ? 'a' : 'e'} nel frigo di prova`)],
    [/^(.+) ist ausverkauft – steht schon in deinem Kühlschrank\.$/, W(0, (m) => `${m[1]} is sold out – it is already in your fridge.`, (m) => `${m[1]} está agotado – ya está en tu nevera.`, (m) => `${m[1]} è esaurito – è già nel tuo frigo.`)],
    [/^Noch ([\d.,]+) kcal$/, W(0, (m) => `${m[1]} kcal left`, (m) => `Quedan ${m[1]} kcal`, (m) => `Ancora ${m[1]} kcal`)],
    [/^([\d.,]+) kcal drüber$/, W(0, (m) => `${m[1]} kcal over`, (m) => `${m[1]} kcal de más`, (m) => `${m[1]} kcal in più`)],
    [/^Zu (Frühstück|Mittagessen|Abendessen|Snacks) hinzufügen$/, W(0, (m, l) => `Add to ${word(l, m[1]).toLowerCase()}`, (m, l) => `Añadir a ${word(l, m[1]).toLowerCase()}`, (m, l) => `Aggiungi a ${word(l, m[1]).toLowerCase()}`)],
    [/^Ergibt ([\d.,]+) kcal – Zielkalorien (.+)\.$/, W(0, (m) => `Adds up to ${m[1]} kcal – calorie target ${m[2]}.`, (m) => `Suma ${m[1]} kcal – objetivo ${m[2]}.`, (m) => `Fa ${m[1]} kcal – obiettivo ${m[2]}.`)],
    [/^Tag (\d+) von (\d+) · noch (\d+) Tage?$/, W(0, (m) => `Day ${m[1]} of ${m[2]} · ${m[3]} left`, (m) => `Día ${m[1]} de ${m[2]} · quedan ${m[3]}`, (m) => `Giorno ${m[1]} di ${m[2]} · ne mancano ${m[3]}`)],
    [/^Tag (\d+) von (\d+) · letzter Tag$/, W(0, (m) => `Day ${m[1]} of ${m[2]} · last day`, (m) => `Día ${m[1]} de ${m[2]} · último día`, (m) => `Giorno ${m[1]} di ${m[2]} · ultimo giorno`)],
    [/^(.+) führt$/, W(0, (m) => `${m[1]} is ahead`, (m) => `${m[1]} va ganando`, (m) => `${m[1]} è in vantaggio`)],
    [/^(.+) · (\d) Wochen?$/, null],
    [/^(\d+) Head2Head-Siege?$/, W(0, (m) => `${m[1]} Head2Head win${m[1] === '1' ? '' : 's'}`, (m) => `${m[1]} victoria${m[1] === '1' ? '' : 's'} Head2Head`, (m) => `${m[1]} vittori${m[1] === '1' ? 'a' : 'e'} Head2Head`)],
    [/^Der Code ist falsch oder abgelaufen\. Noch (\d) Versuche?\.$/, W(0, (m) => `The code is wrong or expired. ${m[1]} tries left.`, (m) => `Código incorrecto o caducado. Quedan ${m[1]} intentos.`, (m) => `Codice errato o scaduto. Ancora ${m[1]} tentativi.`)],
    [/^Per E-Mail an (.+)$/, W(0, (m) => `Email to ${m[1]}`, (m) => `Enviar a ${m[1]}`, (m) => `Invia a ${m[1]}`)],
    [/^(\d+) Tage Schritte · (\d+) Nächte Schlaf$/, W(0, (m) => `${m[1]} days of steps · ${m[2]} nights of sleep`, (m) => `${m[1]} días de pasos · ${m[2]} noches de sueño`, (m) => `${m[1]} giorni di passi · ${m[2]} notti di sonno`)],
    [/^Bis zu (\d) Medaillen für dein Profil – deine Head2Head-Gegner sehen sie\.$/, W(0, (m) => `Up to ${m[1]} medals for your profile – your Head2Head opponents see them.`, (m) => `Hasta ${m[1]} medallas para tu perfil – tus rivales de Head2Head las ven.`, (m) => `Fino a ${m[1]} medaglie per il profilo – i tuoi avversari Head2Head le vedono.`)],
    [/^Noch (\d+) Token$/, W(0, (m) => `${m[1]} more tokens`, (m) => `Faltan ${m[1]} tokens`, (m) => `Ancora ${m[1]} token`)],
    [/^(\d+) Token verdient$/, W(0, (m) => `${m[1]} tokens earned`, (m) => `${m[1]} tokens ganados`, (m) => `${m[1]} token guadagnati`)],
    [/^\(je (\d) Token\)$/, W(0, (m) => `(${m[1]} token${m[1] === '1' ? '' : 's'} each)`, (m) => `(${m[1]} token${m[1] === '1' ? '' : 's'} c/u)`, (m) => `(${m[1]} token l'una)`)],
    [/^(\d+) Updates seit deinem letzten Besuch$/, W(0, (m) => `${m[1]} updates since your last visit`, (m) => `${m[1]} actualizaciones desde tu última visita`, (m) => `${m[1]} aggiornamenti dalla tua ultima visita`)],
    [/^(\d+) (Dosen?) · (\d+) Token übrig$/, W(0, (m) => `${m[1]} can${m[1] === '1' ? '' : 's'} · ${m[3]} tokens left`, (m) => `${m[1]} lata${m[1] === '1' ? '' : 's'} · quedan ${m[3]} tokens`, (m) => `${m[1]} lattin${m[1] === '1' ? 'a' : 'e'} · ${m[3]} token rimasti`)],
    [/^Noch (\d+) Medaillen?$/, W(0, (m) => `${m[1]} more medal${m[1] === '1' ? '' : 's'}`, (m) => `Faltan ${m[1]} medalla${m[1] === '1' ? '' : 's'}`, (m) => `Ancora ${m[1]} medagli${m[1] === '1' ? 'a' : 'e'}`)],
    [/^(\d+) verdient · (\d+) ausgegeben$/, W(0, (m) => `${m[1]} earned · ${m[2]} spent`, (m) => `${m[1]} ganadas · ${m[2]} gastadas`, (m) => `${m[1]} guadagnate · ${m[2]} spese`)],
    [/^(\d+) (Dosen?) · (\d+) (Medaillen?) übrig$/, W(0, (m) => `${m[1]} can${m[1] === '1' ? '' : 's'} · ${m[3]} medal${m[3] === '1' ? '' : 's'} left`, (m) => `${m[1]} lata${m[1] === '1' ? '' : 's'} · quedan ${m[3]} medalla${m[3] === '1' ? '' : 's'}`, (m) => `${m[1]} lattin${m[1] === '1' ? 'a' : 'e'} · ${m[3]} medagli${m[3] === '1' ? 'a' : 'e'} rimast${m[3] === '1' ? 'a' : 'e'}`)],
    [/^(Bronze|Silber|Gold): (.+) – (erreicht|(\d+) % geschafft)$/, null],
    [/^(\d+) (Gold|Silber|Bronze)$/, W(0, (m, l) => `${m[1]} ${word(l, m[2])}`, (m, l) => `${m[1]} ${word(l, m[2])}`, (m, l) => `${m[1]} ${word(l, m[2])}`)],
    [/^(.+) (Bronze|Silber|Gold)$/, W(0, (m, l) => `${word(l, m[1])} ${word(l, m[2])}`, (m, l) => `${word(l, m[1])} ${word(l, m[2])}`, (m, l) => `${word(l, m[1])} ${word(l, m[2])}`)],
    [/^noch ([\d.,]+(?: t)?) (.+)$/, W(0, (m, l) => `${m[1]} ${word(l, m[2])} to go`, (m, l) => `faltan ${m[1]} ${word(l, m[2])}`, (m, l) => `mancano ${m[1]} ${word(l, m[2])}`)],
    [/^(\d+) Tage pro Woche$/, W(0, (m) => `${m[1]} days per week`, (m) => `${m[1]} días por semana`, (m) => `${m[1]} giorni a settimana`)],
    [/^zuletzt ([^·]+)$/, W(0, (m, l) => `last ${word(l, m[1])}`, (m, l) => `último ${word(l, m[1])}`, (m, l) => `ultimo ${word(l, m[1])}`)],
    [/^letzter Eintrag (.+)$/, W(0, (m, l) => `last entry ${word(l, m[1])}`, (m, l) => `último registro ${word(l, m[1])}`, (m, l) => `ultima registrazione ${word(l, m[1])}`)],
    [/^in (\d+) Tagen$/, W(0, (m) => `in ${m[1]} days`, (m) => `en ${m[1]} días`, (m) => `in ${m[1]} giorni`)],
    [/^noch ([^·]+) bis ([^·]+)$/, W(0, (m) => `${m[1]} to go to ${m[2]}`, (m) => `faltan ${m[1]} hasta ${m[2]}`, (m) => `mancano ${m[1]} a ${m[2]}`)],
    [/^Ziel (.+) · (.+)$/, null],
  ];

  let lang = 'de';
  const origText = new WeakMap();
  const origAttr = new WeakMap();
  const ATTRS = ['placeholder', 'aria-label', 'title'];
  let busy = false;

  function translate(text) {
    if (lang === 'de') return text;
    const key = text.replace(/\s+/g, ' ').trim();
    if (!key || !/[A-Za-zÄÖÜäöüß]/.test(key)) return text;
    let out = DICT.has(key) ? DICT.get(key)[lang] : null;
    if (out === null) {
      for (const [re, fns] of PATTERNS) {
        if (!fns) continue;
        const m = key.match(re);
        if (m) {
          out = fns[lang](m, lang);
          break;
        }
      }
    }
    if ((out === null || out === undefined) && key.startsWith('· ')) {
      const rest = translate(key.slice(2));
      if (rest !== key.slice(2)) out = `· ${rest}`;
    }
    if ((out === null || out === undefined) && key.includes(' · ')) {
      // composed texts: translate each "·"-separated part on its own
      const parts = key.split(' · ').map((part) => translate(part));
      if (parts.join(' · ') !== key) out = parts.join(' · ');
    }
    if (out === null || out === undefined) return text;
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    return lead + out + trail;
  }

  const skip = (el) => el && el.closest && el.closest('script, style, [data-no-i18n], textarea, .chat-log, [contenteditable]');

  function doText(node) {
    if (skip(node.parentElement)) return;
    if (!origText.has(node)) origText.set(node, node.nodeValue);
    const want = translate(origText.get(node));
    if (node.nodeValue !== want) node.nodeValue = want;
  }
  function doEl(el) {
    if (skip(el)) return;
    let o = origAttr.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      if (!o) { o = {}; origAttr.set(el, o); }
      if (!(a in o)) o[a] = el.getAttribute(a);
      const want = translate(o[a]);
      if (el.getAttribute(a) !== want) el.setAttribute(a, want);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    doEl(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = it.nextNode())) n.nodeType === 3 ? doText(n) : doEl(n);
  }
  let observer = null;
  function run(fn) {
    busy = true;
    try {
      fn();
    } finally {
      if (observer) observer.takeRecords(); // drop the mutations we just made ourselves
      busy = false;
    }
  }

  observer = new MutationObserver((list) => {
    if (busy) return;
    run(() => {
      for (const m of list) {
        if (m.type === 'characterData') {
          origText.set(m.target, m.target.nodeValue); // the app changed this text: it is the new original
          doText(m.target);
        } else if (m.type === 'attributes') {
          const o = origAttr.get(m.target);
          if (o) o[m.attributeName] = m.target.getAttribute(m.attributeName);
          doEl(m.target);
        } else {
          m.addedNodes.forEach(walk);
        }
      }
    });
  });

  function setLang(l) {
    lang = LANGS.includes(l) ? l : 'de';
    document.documentElement.lang = lang;
    run(() => walk(document.body));
  }

  function start() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    if (lang !== 'de') run(() => walk(document.body));
  }

  window.I18N = {
    setLang,
    t: translate,
    get lang() { return lang; },
    get locale() { return LOCALES[lang]; },
  };
  try {
    const p = JSON.parse(localStorage.getItem('sot-prefs') || '{}');
    if (LANGS.includes(p.lang)) lang = p.lang;
  } catch { /* ignore */ }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
