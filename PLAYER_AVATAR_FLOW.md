# Player avatar flow

1. Spilleren skal have en claimed VCL player profile.
2. På Account vælges PNG/JPG/WEBP, maks. 2 MB.
3. Browseren center-cropper til 1:1, resizer til 512×512 og eksporterer WEBP under Storage-limit.
4. Filen uploades til den private `player-avatar-pending` bucket.
5. Den offentlige profil beholder tidligere godkendt avatar eller initial-fallback.
6. Admin ser pending preview i Admin → Spillere og vælger Godkend/Afvis.
7. Ved Godkend uploades filen til den offentlige `player-avatars` bucket, og `players.avatar_url` aktiveres.
8. Ved Afvis slettes pending-filen og spilleren kan sende et nyt billede.

Security er håndhævet med Supabase Storage policies og security-definer RPC'er; UI'et alene giver ingen rettigheder.
