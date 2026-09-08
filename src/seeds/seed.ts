import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from 'src/app.module';
import { Genre, Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

export async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const userRepo = app.get<Repository<User>>('UserRepository');
  const lyricsRepo = app.get<Repository<Lyrics>>('LyricsRepository');

  const hashedPassword = await bcrypt.hash('yourAdminPassword', 10);

  const adminEmail = 'admin@lyricflip.local';
  let admin = await userRepo.findOne({ where: { email: adminEmail } });
  if (!admin) {
    admin = userRepo.create({
      email: adminEmail,
      username: 'seedadmin',
      name: 'Seed Admin',
      passwordHash: hashedPassword,
    });
    admin = await userRepo.save(admin);
  }

  // Seed lyrics
  const sampleLyrics = [
    {
      content: "I got my eyes on you, you're everything that I see",
      songTitle: "Can't Feel My Face (sample line - not exact)",
      artist: 'The Weeknd',
      genre: Genre.Afrobeats,
      decade: 2010,
    },
    {
      content: 'I want to hold your hand',
      songTitle: 'I Want to Hold Your Hand',
      artist: 'The Beatles',
      genre: Genre.HipHop,
      decade: 1960,
    },
    {
      content: 'You used to call me on my cell phone',
      songTitle: 'Hotline Bling',
      artist: 'Drake',
      genre: Genre.HipHop,
      decade: 2010,
    },
    {
      content: 'Sunrise, sunset, and the lights go down',
      songTitle: 'Summer Memory',
      artist: 'Indie Artist',
      genre: Genre.Pop,
      decade: 2020,
    },
    {
      content: "Baby, you're a firework",
      songTitle: 'Firework',
      artist: 'Katy Perry',
      genre: Genre.Pop,
      decade: 2010,
    },
    {
      content: 'I walk this empty street on the boulevard of broken dreams',
      songTitle: 'Boulevard of Broken Dreams',
      artist: 'Green Day',
      genre: Genre.Afrobeats,
      decade: 2000,
    },
    {
      content: 'Feel the rhythm, feel the rhyme',
      songTitle: 'Hip Hop Sample',
      artist: 'Old School MC',
      genre: Genre.HipHop,
      decade: 1990,
    },
    {
      content: 'If you ever find yourself stuck in the middle of the sea',
      songTitle: 'Fix You (sample)',
      artist: 'Coldplay',
      genre: Genre.Other,
      decade: 2000,
    },
    {
      content: 'Oya, come dance — the beat says move your feet',
      songTitle: 'Afro Groove',
      artist: 'Afro Star',
      genre: Genre.Afrobeats,
      decade: 2010,
    },
    {
      content: "We don't need no education",
      songTitle: 'Another Brick (sample)',
      artist: 'Pink Floyd',
      genre: Genre.HipHop,
      decade: 1970,
    },
    {
      content: "Shawty got me staring like I'm in a dream",
      songTitle: 'R&B Vibe',
      artist: 'RnB Singer',
      genre: Genre.Pop,
      decade: 2000,
    },
    {
      content: 'Started from the bottom now we here',
      songTitle: 'Started From the Bottom',
      artist: 'Drake',
      genre: Genre.HipHop,
      decade: 2010,
    },
    {
      content: 'I found love in a hopeless place',
      songTitle: 'Halo (sample)',
      artist: 'Beyoncé',
      genre: Genre.HipHop,
      decade: 2000,
    },
    {
      content: "Rollin' with the homies",
      songTitle: '90s Vibe',
      artist: 'West Coast Crew',
      genre: Genre.HipHop,
      decade: 1990,
    },
    {
      content: 'Tonight we dance under neon lights',
      songTitle: 'Neon Night',
      artist: 'Synth Pop Group',
      genre: Genre.Other,
      decade: 1980,
    },
    {
      content: "My baby, my baby, don't worry 'bout a thing",
      songTitle: 'Soul Sample',
      artist: 'Soul Singer',
      genre: Genre.Other,
      decade: 1970,
    },
    {
      content: 'Late night drive, windows down, feeling free',
      songTitle: 'City Drive',
      artist: 'Pop Rocker',
      genre: Genre.Pop,
      decade: 2010,
    },
    {
      content: 'We will, we will rock you',
      songTitle: 'We Will Rock You',
      artist: 'Queen',
      genre: Genre.Pop,
      decade: 1970,
    },
    {
      content: "They say the future's bright, we just gotta reach",
      songTitle: 'Future Sound',
      artist: 'Electro Artist',
      genre: Genre.Other,
      decade: 2020,
    },
    {
      content: "Gimme the beat and I'll take it higher",
      songTitle: 'Dance Anthem',
      artist: 'DJ Pulse',
      genre: Genre.Other,
      decade: 2010,
    },
  ];

  for (const lyric of sampleLyrics) {
    const exists = await lyricsRepo.findOne({
      where: {
        content: lyric.content,
        artist: lyric.artist,
        songTitle: lyric.songTitle,
      },
    });

    if (!exists) {
      await lyricsRepo.save({
        content: lyric.content,
        songTitle: lyric.songTitle,
        artist: lyric.artist,
        genre: lyric.genre,
        decade: String(lyric.decade),
        createdBy: { id: admin.id },
        createdAt: new Date(),
      });
    }
  }

  console.log('Seeding complete');
  await app.close();
}
// Only seed when the file is executed directly (`npm run seed`); importing it
// — as the spec does — must not touch the database.
if (require.main === module) {
  void bootstrap();
}
